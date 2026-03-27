import { useEffect, useRef, useCallback, useState } from 'react'
import '@blocknote/mantine/style.css'
import { BlockNoteView } from '@blocknote/mantine'
import { useCreateBlockNote, SuggestionMenuController, getDefaultReactSlashMenuItems } from '@blocknote/react'
import { insertOrUpdateBlockForSlashMenu } from '@blocknote/core'
import { useTranscriptStore } from '../../stores/transcriptStore'
import { editorSchema, codeBlocksToMermaid } from './mermaidBlock'

interface AiSummaryPanelProps {
  meetingId: number
  isRecording?: boolean
  editable?: boolean
  onNotesChange?: (markdown: string) => void
}

export function AiSummaryPanel({ meetingId: _meetingId, isRecording = false, editable = true, onNotesChange }: AiSummaryPanelProps) {
  const meetingNotes = useTranscriptStore((s) => s.meetingNotes)
  const setMeetingNotes = useTranscriptStore((s) => s.setMeetingNotes)
  const prevMarkdownRef = useRef<string>('')
  const isUserEditingRef = useRef(false)
  const isProgrammaticRef = useRef(false)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const editor = useCreateBlockNote({ schema: editorSchema })

  useEffect(() => {
    let cancelled = false

    // meetingNotes가 null이면 에디터 초기화 (새 회의 진입 시)
    if (meetingNotes === null) {
      prevMarkdownRef.current = ''
      isProgrammaticRef.current = true
      editor.replaceBlocks(editor.document, [])
      requestAnimationFrame(() => { isProgrammaticRef.current = false })
      return () => { cancelled = true }
    }
    if (meetingNotes === prevMarkdownRef.current) return () => { cancelled = true }
    if (isUserEditingRef.current) {
      prevMarkdownRef.current = meetingNotes
      return () => { cancelled = true }
    }
    prevMarkdownRef.current = meetingNotes
    async function updateBlocks() {
      try {
        isProgrammaticRef.current = true
        const blocks = await editor.tryParseMarkdownToBlocks(meetingNotes!)
        if (cancelled) return
        const converted = codeBlocksToMermaid(blocks as any[])
        editor.replaceBlocks(editor.document, converted as any)
      } catch { /* ignore */ } finally {
        if (!cancelled) {
          requestAnimationFrame(() => { isProgrammaticRef.current = false })
        }
      }
    }
    updateBlocks()
    return () => { cancelled = true }
  }, [meetingNotes, editor])

  const saveNow = useCallback(async () => {
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
          const md = await editor.blocksToMarkdownLossy(g.blocks as any)
          const trimmed = md.trimEnd()
          if (trimmed) parts.push(trimmed)
        }
      }
      const markdown = parts.join('\n\n')

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
    if (isRecording) {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = setTimeout(saveNow, 2000)
    }
  }, [isRecording, saveNow])

  const handleManualSave = useCallback(async () => {
    setIsSaving(true)
    await saveNow()
    setIsSaving(false)
  }, [saveNow])

  useEffect(() => {
    return () => { if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current) }
  }, [])

  return (
    <>
      <div className="flex items-center justify-between px-4 py-2 border-b bg-gray-50 shrink-0">
        <h2 className="text-sm font-semibold text-gray-500">AI 회의록</h2>
        {editable && (
          isRecording ? (
            <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-green-100 text-green-600">
              자동 저장
            </span>
          ) : (
            <button
              onClick={handleManualSave}
              disabled={!isDirty || isSaving}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
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
      <div className="flex-1 overflow-y-auto">
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
    </>
  )
}
