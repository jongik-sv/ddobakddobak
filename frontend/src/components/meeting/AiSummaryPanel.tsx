import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import { Maximize2 } from 'lucide-react'
import '@blocknote/mantine/style.css'
import { BlockNoteView } from '@blocknote/mantine'
import { useCreateBlockNote, SuggestionMenuController, getDefaultReactSlashMenuItems } from '@blocknote/react'
import { insertOrUpdateBlockForSlashMenu } from '@blocknote/core'
import { useTranscriptStore } from '../../stores/transcriptStore'
import { useAppSettingsStore } from '../../stores/appSettingsStore'
import { editorSchema, codeBlocksToMermaid } from './mermaidBlock'
import { markersToInline, inlineToMarkers } from './citationInline'
import { speakerAtMs } from '../../lib/citationMarkers'
import { shouldShowDiarizationHint } from './diarizationHint'
import { AiSummaryFullViewModal } from './AiSummaryFullViewModal'

/**
 * Defense 2 (데이터 손실 가드): 자동저장이 파괴적인 빈 저장인지 판정한다.
 * 다음 내용이 비었는데(공백만 포함) 이전 내용이 비어있지 않으면 의심스러운 빈 저장.
 * (예: Ctrl+Z로 프로그래매틱 주입이 undo되어 문서가 빈 상태로 돌아간 경우)
 */
export function isSuspiciousEmptySave(nextMarkdown: string, prevMarkdown: string): boolean {
  return nextMarkdown.trim() === '' && prevMarkdown.trim() !== ''
}

interface AiSummaryPanelProps {
  meetingId: number
  isRecording?: boolean
  editable?: boolean
  onNotesChange?: (markdown: string) => void
  /** 헤더 우측에 끼울 추가 컨트롤 (요약 옵션 등). 페이지가 주입한다. */
  headerExtra?: React.ReactNode
  /** 전체보기(확대) 버튼 숨김. 전체보기 모달 안에서 마운트될 때 true로 재귀를 막는다. 기본 false. */
  hideExpand?: boolean
  /** 오디오 점프 콜백. ms 단위. */
  onSeek?: (ms: number) => void
}

export function AiSummaryPanel({ meetingId, isRecording = false, editable = true, onNotesChange, headerExtra, hideExpand = false, onSeek }: AiSummaryPanelProps) {
  const meetingNotes = useTranscriptStore((s) => s.meetingNotes)
  const setMeetingNotes = useTranscriptStore((s) => s.setMeetingNotes)
  const isSummarizing = useTranscriptStore((s) => s.isSummarizing)
  const summarizationKind = useTranscriptStore((s) => s.summarizationKind)
  const finals = useTranscriptStore((s) => s.finals)
  const diarizationEnabled = useAppSettingsStore((s) => s.diarizationEnabled)

  // 실제로 화자가 둘 이상 분리됐을 때만 안내(전부 같은 화자라벨이면 거짓 "분리 완료" 차단)
  const showManualHint = useMemo(
    () => shouldShowDiarizationHint({ diarizationEnabled, finals, meetingNotes, isSummarizing }),
    [diarizationEnabled, finals, meetingNotes, isSummarizing],
  )
  const prevMarkdownRef = useRef<string>('')
  const isUserEditingRef = useRef(false)
  const isProgrammaticRef = useRef(false)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [showFullView, setShowFullView] = useState(false)

  const editor = useCreateBlockNote({ schema: editorSchema })

  // onSeek를 전역 핸들로 등록 — CitationInline render가 참조
  // onSeek가 없으면(예: AiSummaryFullViewModal의 중첩 패널) 등록/해제 모두 건너뜀.
  // 이렇게 해야 중첩 패널이 외부 패널의 핸들을 __ddobakSeek=undefined로 덮어쓰지 않는다.
  useEffect(() => {
    if (!onSeek) return
    ;(window as any).__ddobakSeek = onSeek
    return () => { if ((window as any).__ddobakSeek === onSeek) delete (window as any).__ddobakSeek }
  }, [onSeek])

  // 현재(화자분리 후) 화자 해석기를 전역 핸들로 등록 — CitationInline render가 배지 시각으로 호출.
  // 마커에 박힌 옛 화자 대신 finals 기준 최신 화자를 색·툴팁에 반영하기 위함.
  // finals가 매 렌더 새 클로저이므로 const fn으로 캡처해 cleanup의 ref 비교가 일치하게 한다.
  useEffect(() => {
    const fn = (ms: number) => speakerAtMs(finals, ms)
    ;(window as any).__ddobakSpeakerAt = fn
    return () => { if ((window as any).__ddobakSpeakerAt === fn) delete (window as any).__ddobakSpeakerAt }
  }, [finals])

  useEffect(() => {
    let cancelled = false

    // meetingNotes가 null이면 에디터 초기화 (새 회의 진입·회의록 재생성 시).
    // 보류 중인 자동저장도 취소 — 안 하면 옛 내용/빈 문서가 user-edit으로 저장돼
    // 재생성 결과를 stale 가드가 폐기한다(160초 LLM 결과 증발 버그).
    if (meetingNotes === null) {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      isUserEditingRef.current = false
      setIsDirty(false)
      prevMarkdownRef.current = ''
      isProgrammaticRef.current = true
      // Defense 1: 프로그래매틱 주입을 undo 히스토리에서 제외 (Ctrl+Z로 빈 상태 복귀→소실 방지)
      editor.transact((tr: any) => {
        tr.setMeta('addToHistory', false)
        editor.replaceBlocks(editor.document, [])
      })
      requestAnimationFrame(() => { isProgrammaticRef.current = false })
      return () => { cancelled = true }
    }
    if (meetingNotes === prevMarkdownRef.current) return () => { cancelled = true }
    if (isUserEditingRef.current) {
      prevMarkdownRef.current = meetingNotes ?? ''
      return () => { cancelled = true }
    }
    async function updateBlocks() {
      try {
        isProgrammaticRef.current = true
        const blocks = await editor.tryParseMarkdownToBlocks(meetingNotes!)
        if (cancelled) return
        const converted = markersToInline(codeBlocksToMermaid(blocks as any[]))
        // Defense 1: 프로그래매틱 주입을 undo 히스토리에서 제외 (Ctrl+Z로 빈 상태 복귀→소실 방지)
        editor.transact((tr: any) => {
          tr.setMeta('addToHistory', false)
          editor.replaceBlocks(editor.document, converted as any)
        })
        prevMarkdownRef.current = meetingNotes ?? ''
      } catch { /* ignore */ } finally {
        if (!cancelled) {
          requestAnimationFrame(() => { isProgrammaticRef.current = false })
        }
      }
    }
    updateBlocks()
    return () => { cancelled = true }
  }, [meetingNotes, editor])

  const saveNow = useCallback(async (source: 'auto' | 'manual' = 'auto') => {
    try {
      const doc = editor.document as any[]

      // 연속된 비-mermaid 블록을 그룹으로 묶고, mermaid는 별도 처리
      const groups: ({ kind: 'blocks'; blocks: any[] } | { kind: 'mermaid'; code: string })[] = []
      for (const block of doc) {
        if (block.type === 'mermaid') {
          groups.push({ kind: 'mermaid', code: (block.props as { code: string }).code || '' })
        } else {
          const last = groups[groups.length - 1]
          if (last?.kind === 'blocks') {
            last.blocks.push(block)
          } else {
            groups.push({ kind: 'blocks', blocks: [block] })
          }
        }
      }

      const parts: string[] = []
      for (const g of groups) {
        if (g.kind === 'mermaid') {
          if (g.code.trim()) parts.push('```mermaid\n' + g.code + '\n```')
        } else {
          const md = await editor.blocksToMarkdownLossy(inlineToMarkers(g.blocks as any) as any)
          const trimmed = md.trimEnd()
          if (trimmed) parts.push(trimmed)
        }
      }
      const markdown = parts.join('\n\n')

      // Defense 2: 자동저장이 파괴적 빈 저장이면(이전엔 내용 있는데 지금 빈 상태) 저장 차단.
      // Ctrl+Z가 USER edit으로 오인돼 빈 마크다운이 영구 저장되는 것을 방지.
      // 수동 저장(source='manual')은 의도적 비우기이므로 통과시킨다. isDirty는 유지해
      // 사용자가 정말 비우려면 수동 저장으로 가능하게 둔다.
      if (source === 'auto' && isSuspiciousEmptySave(markdown, prevMarkdownRef.current)) {
        console.warn(
          '[saveNow] 의심스러운 빈 자동저장 차단: 이전 회의록이 존재하는데 빈 내용으로 저장 시도됨(예: Ctrl+Z). 저장하지 않음. 정말 비우려면 수동 저장하세요.',
        )
        isUserEditingRef.current = false
        return
      }

      prevMarkdownRef.current = markdown
      setMeetingNotes(markdown)
      onNotesChange?.(markdown)
      setIsDirty(false)
    } catch (e) {
      console.error('[saveNow] 저장 실패:', e)
    } finally {
      isUserEditingRef.current = false
    }
  }, [editor, setMeetingNotes, onNotesChange])

  const handleChange = useCallback(() => {
    if (isProgrammaticRef.current) return
    isUserEditingRef.current = true
    setIsDirty(true)
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => saveNow('auto'), 2000)
  }, [saveNow])

  const handleManualSave = useCallback(async () => {
    setIsSaving(true)
    await saveNow('manual')
    setIsSaving(false)
  }, [saveNow])

  useEffect(() => {
    return () => { if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current) }
  }, [])

  return (
    <>
      <div className="flex items-center justify-between px-4 py-2 border-b bg-gray-50 shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-500">AI 회의록</h2>
          {isSummarizing && (
            <span
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-blue-50 text-blue-700"
              role="status"
              aria-live="polite"
              title={summarizationKind === 'final' ? '최종 요약 생성 중' : '요약 갱신 중'}
            >
              <svg
                className="w-3 h-3 animate-spin text-blue-600"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
                <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
              </svg>
              {summarizationKind === 'final' ? '최종 요약 중...' : '요약 중...'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {headerExtra}
          {!hideExpand && (
            <button
              onClick={() => setShowFullView(true)}
              aria-label="전체보기"
              title="전체보기"
              className="p-1.5 min-h-[44px] flex items-center rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          )}
        {editable && (
          isRecording ? (
            <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-green-100 text-green-600">
              자동 저장
            </span>
          ) : (
            <button
              onClick={handleManualSave}
              disabled={!isDirty || isSaving}
              className={`px-2 py-0.5 min-h-[44px] flex items-center rounded text-[11px] font-medium transition-colors ${
                isDirty
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-gray-100 text-gray-400 cursor-default'
              } disabled:opacity-50`}
            >
              {isSaving ? '저장 중...' : isDirty ? '저장' : '저장됨'}
            </button>
          )
        )}
        </div>
      </div>
      {showManualHint && (
        <div className="mx-4 mt-3 rounded-md border border-blue-100 bg-blue-50/50 p-3 text-xs text-blue-700">
          화자분리가 완료되었습니다. 좌측 화자 목록에서 이름을 지정한 뒤
          <span className="font-semibold"> 회의록 재생성</span> 버튼으로 회의록을 만들 수 있습니다.
        </div>
      )}
      <div className="flex-1 overflow-y-auto select-text">
        {editable ? (
          <BlockNoteView
            editor={editor}
            editable={true}
            onChange={handleChange}
            theme="light"
            slashMenu={false}
          >
            <SuggestionMenuController
              triggerCharacter="/"
              getItems={async (query) => {
                const defaults = getDefaultReactSlashMenuItems(editor)
                const mermaidItem = {
                  title: 'Mermaid 다이어그램',
                  onItemClick: () => {
                    insertOrUpdateBlockForSlashMenu(editor, {
                      type: 'mermaid' as any,
                      props: { code: '' },
                    })
                  },
                  aliases: ['mermaid', 'diagram', '다이어그램', '차트'],
                  group: '미디어',
                  subtext: '플로우차트, 시퀀스 등 다이어그램 삽입',
                }
                return [...defaults, mermaidItem].filter(
                  (item) =>
                    !query ||
                    item.title.toLowerCase().includes(query.toLowerCase()) ||
                    item.aliases?.some((a: string) => a.toLowerCase().includes(query.toLowerCase())),
                )
              }}
            />
          </BlockNoteView>
        ) : (
          <BlockNoteView
            editor={editor}
            editable={false}
            theme="light"
          />
        )}
      </div>
      {showFullView && (
        <AiSummaryFullViewModal
          meetingId={meetingId}
          editable={false}
          onClose={() => setShowFullView(false)}
        />
      )}
    </>
  )
}
