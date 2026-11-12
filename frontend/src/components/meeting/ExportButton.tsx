import { useState, useRef, useEffect, useMemo } from 'react'
import { Download } from 'lucide-react'
import { exportMeeting, exportMeetingData, exportPrompt } from '../../api/meetings'
import type { Meeting } from '../../api/meetings'
import { getDflowSettings } from '../../api/dflow'
import { downloadMarkdown } from '../../lib/markdown'
import { downloadBlob, downloadText } from '../../lib/download'
import { Tooltip } from '../ui/Tooltip'
import { ACTION_NEUTRAL } from './actionButtonStyles'
import SendToDflowDialog from './SendToDflowDialog'
import { getWhiteboardSettings } from '../../api/settings'
import { IS_TAURI } from '../../config'
import { formatFilenameDate, buildCopyInstruction, buildInstructionFilename, buildWhiteboardFilename, buildWhiteboardMaterial, resolveWhiteboardRoute } from '../../lib/whiteboard'
import type { WhiteboardMaterial, WhiteboardRoute } from '../../lib/whiteboard'
import { detectLocalClaude } from '../../lib/whiteboard/runner'
import { materialDigest, selectEntry, useWhiteboardStore } from '../../stores/whiteboardStore'

type ExportFormat = 'md' | 'pdf' | 'docx' | 'prompt' | 'whiteboard'

const WB_COPY_NOTICE = {
  disabled:
    'Claude 화이트보드가 꺼져 있습니다. 대신 화이트보드 작성 지시문을 .txt 파일로 내려받아, 내 Claude Code나 claude.ai에 붙여 넣어 만들 수 있습니다.',
  noClaude: '서버에서 Claude Code를 찾을 수 없어 화이트보드를 바로 만들 수 없습니다. 대신 지시문을 .txt 파일로 내려받아 주세요.',
  unknown: '화이트보드 설정을 확인하지 못했습니다. 지시문을 .txt 파일로 내려받아 주세요.',
} as const

const NO_SUMMARY_TIP = 'AI 회의록이 있어야 만들 수 있습니다'

interface ExportButtonProps {
  meetingId: number
  meetingTitle?: string
  meetingDate?: string | null
  /** D'Flow 진입점 노출 조건(status)과 team 자동판정 미리보기(folder_path)에 필요한 전체 meeting.
   *  MeetingActions.tsx가 이미 들고 있는 값을 그대로 전달받는다(자체 재조회 없음). 미지정 시
   *  D'Flow 진입점은 노출되지 않는다. */
  meeting?: Meeting
  /** SendToDflowDialog의 전송/연결 mutation 성공 시 호출 — 상위가 meeting을 refetch해 배지·
   *  이 항목의 상태 텍스트를 최신화하도록 전달한다(SendToDflowDialog로 그대로 전달). */
  onChanged?: () => void
}

/** 파일명에 사용할 수 없는 문자를 제거하고 안전한 이름을 만든다 */
function sanitizeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '').replace(/\s+/g, '_').slice(0, 100)
}

function buildExportFilename(title: string | undefined, format: ExportFormat, date?: string | Date): string {
  const dateStr = formatFilenameDate(date)
  const baseName = title ? sanitizeFilename(title) : 'meeting'
  const ext = format === 'prompt' ? 'txt' : format === 'whiteboard' ? 'html' : format
  return `${baseName}_${dateStr}.${ext}`
}

export function ExportButton({ meetingId, meetingTitle, meetingDate, meeting, onChanged }: ExportButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [format, setFormat] = useState<ExportFormat>('md')
  const [includeSummary, setIncludeSummary] = useState(true)
  const [includeMemo, setIncludeMemo] = useState(true)
  const [includeTranscript, setIncludeTranscript] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // 화이트보드: 패널을 열 때 재료·경로를 미리 받아 둔다(클립보드 writeText가 클릭 제스처 안에서
  // 동기 호출돼야 하므로 복사 경로는 클릭 시점에 await 할 것이 없어야 한다).
  const [wbMaterial, setWbMaterial] = useState<WhiteboardMaterial | null>(null)
  const [wbLoaded, setWbLoaded] = useState(false)
  const [wbRoute, setWbRoute] = useState<WhiteboardRoute | null>(null)
  const [wbCopyReason, setWbCopyReason] = useState<'disabled' | 'noClaude' | 'unknown'>('unknown')
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'manual' | 'downloaded'>('idle')
  const manualRef = useRef<HTMLTextAreaElement>(null)
  const wbEntry = useWhiteboardStore((st) => selectEntry(st, meetingId))
  const startLocal = useWhiteboardStore((st) => st.startLocal)
  const startServer = useWhiteboardStore((st) => st.startServer)
  const refreshServer = useWhiteboardStore((st) => st.refreshServer)
  const saveWhiteboard = useWhiteboardStore((st) => st.save)
  const resetWhiteboard = useWhiteboardStore((st) => st.reset)
  const setPanelOpen = useWhiteboardStore((st) => st.setPanelOpen)

  // 패널 열림 여부를 스토어에 알린다 — 닫힌 채 생성이 끝나면 전역 토스트가 뜬다.
  useEffect(() => {
    setPanelOpen(meetingId, isOpen)
  }, [isOpen, meetingId, setPanelOpen])
  useEffect(() => () => setPanelOpen(meetingId, false), [meetingId, setPanelOpen])

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    setWbLoaded(false)
    setCopyState('idle')
    ;(async () => {
      let material: WhiteboardMaterial | null = null
      try {
        const data = await exportMeetingData(meetingId, {
          include_summary: true,
          include_memo: false,
          include_transcript: false,
        })
        material = buildWhiteboardMaterial(data)
      } catch {
        material = null
      }
      if (cancelled) return
      setWbMaterial(material)
      if (!material) {
        setWbRoute('copy')
        setWbLoaded(true)
        return
      }
      const localClaude = await detectLocalClaude()
      let settings: Awaited<ReturnType<typeof getWhiteboardSettings>> | null = null
      if (!localClaude) {
        try {
          settings = await getWhiteboardSettings()
        } catch {
          settings = null
        }
      }
      if (cancelled) return
      setWbCopyReason(!settings ? 'unknown' : settings.web_mode === 'copy' ? 'disabled' : 'noClaude')
      setWbRoute(
        resolveWhiteboardRoute({
          isTauri: IS_TAURI,
          localClaude,
          webMode: settings?.web_mode ?? null,
          serverClaudeAvailable: settings?.server_claude_available ?? null,
        }),
      )
      setWbLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [isOpen, meetingId])

  const wbFilename = useMemo(
    () => buildWhiteboardFilename(meetingTitle || wbMaterial?.title || undefined, wbMaterial?.date ?? meetingDate ?? undefined),
    [meetingTitle, meetingDate, wbMaterial],
  )
  const wbInstructionFilename = useMemo(
    () => buildInstructionFilename(meetingTitle || wbMaterial?.title || undefined, wbMaterial?.date ?? meetingDate ?? undefined),
    [meetingTitle, meetingDate, wbMaterial],
  )
  const wbInstruction = useMemo(
    () => (wbMaterial ? buildCopyInstruction({ ...wbMaterial, title: meetingTitle || wbMaterial.title }, wbFilename) : ''),
    [wbMaterial, meetingTitle, wbFilename],
  )
  // 실행 중/완료 entry 가 있으면 detect·재료 조회 결과와 무관하게 그 화면을 유지한다.
  const wbHasEntry = wbEntry.status === 'running' || wbEntry.status === 'done'
  const noSummary = wbLoaded && !wbMaterial && !wbHasEntry
  // 회의록(재요약 등)이 만든 뒤에 바뀌었는지.
  const wbStale =
    wbEntry.status === 'done' &&
    (wbEntry.source === 'server'
      ? wbEntry.serverStale
      : !!wbMaterial && materialDigest({ ...wbMaterial, title: meetingTitle || wbMaterial.title }) !== wbEntry.digest)

  // 서버 경로: 패널을 열 때(또는 running 상태로 다시 열 때) GET 으로 기존 done·running·error 를 복원한다.
  useEffect(() => {
    if (!isOpen || !wbLoaded || wbRoute !== 'server') return
    void refreshServer(meetingId, wbFilename)
  }, [isOpen, wbLoaded, wbRoute, meetingId, wbFilename, refreshServer])

  useEffect(() => {
    if (copyState === 'manual') manualRef.current?.select()
  }, [copyState])

  // D'Flow 진입점: 노출 조건(status)·team 자동판정 미리보기(folder_path)는 meeting prop으로
  // 받는다(자체 재조회 없음 — 부모가 이미 들고 있는 값 재사용). 연동 활성화 여부만 패널 열릴 때
  // getDflowSettings()로 조회.
  const [dflowEnabled, setDflowEnabled] = useState(false)
  const [showDflowDialog, setShowDflowDialog] = useState(false)

  // 외부 클릭으로 패널 닫기
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    getDflowSettings()
      .then((settings) => {
        if (cancelled) return
        setDflowEnabled(settings.enabled)
      })
      .catch(() => {
        // 실패 시 항목을 숨긴다(fail-closed) — 활성화 여부를 확인할 수 없으면 노출하지 않음.
        if (cancelled) return
        setDflowEnabled(false)
      })
    return () => {
      cancelled = true
    }
  }, [isOpen])

  const exportOptions = {
    include_summary: includeSummary,
    include_memo: includeMemo,
    include_transcript: includeTranscript,
  }

  const handleDownload = async () => {
    setIsDownloading(true)
    setError(null)
    try {
      const filename = buildExportFilename(meetingTitle, format, meetingDate ?? undefined)

      if (format === 'prompt') {
        const content = await exportPrompt(meetingId)
        await downloadText(content, filename)
      } else if (format === 'md') {
        const content = await exportMeeting(meetingId, exportOptions)
        await downloadMarkdown(content, filename)
      } else {
        const data = await exportMeetingData(meetingId, exportOptions)
        console.log('[EXPORT] format=', format, 'data received, summary type=', data.summary?.type)

        let blob: Blob
        if (format === 'pdf') {
          const { generatePdf } = await import('../../lib/pdfExporter')
          blob = await generatePdf(data)
        } else {
          const { generateDocx } = await import('../../lib/docxExporter')
          console.log('[EXPORT] calling generateDocx')
          blob = await generateDocx(data)
        }
        await downloadBlob(blob, filename)
      }
      setIsOpen(false)
    } catch {
      setError('내보내기에 실패했습니다. 다시 시도해 주세요.')
    } finally {
      setIsDownloading(false)
    }
  }

  const handleWhiteboardCopy = async () => {
    setError(null)
    try {
      await navigator.clipboard.writeText(wbInstruction)
      setCopyState('copied')
    } catch {
      setCopyState('manual')
    }
  }

  const handleWhiteboardInstructionDownload = async () => {
    setError(null)
    try {
      await downloadText(wbInstruction, wbInstructionFilename)
      setCopyState('downloaded')
    } catch {
      setError('지시문을 내려받지 못했습니다. 다시 시도해 주세요.')
    }
  }

  const handleWhiteboardLocal = () => {
    if (!wbMaterial) return
    void startLocal(meetingId, { ...wbMaterial, title: meetingTitle || wbMaterial.title }, wbFilename)
  }

  const handleWhiteboardServer = async () => {
    if (!wbMaterial) return
    const r = await startServer(meetingId, { ...wbMaterial, title: meetingTitle || wbMaterial.title }, wbFilename)
    // 403: 서버 모드가 꺼졌거나 서버에 claude 가 없어졌다 — 지시문 내려받기로 폴백.
    if (r === 'disabled') {
      setWbRoute('copy')
      setWbCopyReason('disabled')
      setCopyState('idle')
    }
  }

  const handleWhiteboardGenerate = () => {
    if (wbIsServer) void handleWhiteboardServer()
    else handleWhiteboardLocal()
  }

  const isWb = format === 'whiteboard'
  const wbServerError = wbEntry.status === 'error' && wbEntry.source === 'server'
  const wbCopyMode = !wbHasEntry && !wbServerError && wbRoute !== 'local' && wbRoute !== 'server'
  const wbIsServer = !wbCopyMode && (wbEntry.status !== 'idle' ? wbEntry.source === 'server' : wbRoute === 'server')
  const wbSubtext =
    !wbLoaded && !wbHasEntry
      ? '확인 중…'
      : wbCopyMode
        ? '지시문 내려받기 · 내 Claude에서'
        : wbIsServer
          ? '서버의 Claude Code'
          : '이 PC의 Claude Code'
  const wbDone = wbCopyMode ? copyState !== 'idle' : wbEntry.status === 'done' || wbEntry.status === 'error'
  const wbBusy = !wbCopyMode && wbEntry.status === 'running'

  const downloadLabel = format === 'prompt' ? '다운로드 .txt' : `다운로드 .${format}`

  return (
    <div className="relative" ref={panelRef}>
      {/* 트리거 버튼 — Tooltip은 트리거만 감싼다(아래 드롭다운 패널은 relative div의 형제로 유지해 앵커 위치 보존) */}
      <Tooltip text="내보내기">
        <button
          onClick={() => {
            if (!isOpen && wbEntry.status !== 'idle') setFormat('whiteboard')
            setIsOpen((o) => !o)
          }}
          className={ACTION_NEUTRAL}
          aria-label="내보내기"
        >
          <Download className="w-4 h-4" />
          <span className="hidden min-[1440px]:inline">내보내기</span>
        </button>
      </Tooltip>

      {/* 옵션 패널 — D'Flow 구획을 위해 w-80(320px)으로 확대(기존 w-64) */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-1 w-80 bg-card border border-border rounded-lg shadow-lg p-4 z-50">
          <p className="text-sm font-medium text-foreground mb-3">회의록 내보내기</p>

          {/* 형식 선택 — 파일 / AI 생성 두 줄 */}
          <p className="text-[11px] text-muted-foreground mb-1">파일</p>
          <div className="flex gap-1.5 mb-2">
            {(['md', 'pdf', 'docx'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFormat(f)}
                className={`flex-1 px-2 py-1.5 min-h-[44px] text-xs font-medium rounded-md border transition-colors ${
                  format === f
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-card text-muted-foreground border-border hover:border-blue-400'
                }`}
              >
                {`.${f}`}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground mb-1">AI 생성</p>
          <div className="grid grid-cols-[2fr_1fr] gap-1.5 mb-3">
            <span title={noSummary ? NO_SUMMARY_TIP : undefined} className="flex">
              <button
                onClick={() => setFormat('whiteboard')}
                disabled={noSummary}
                aria-label="화이트보드"
                className={`flex-1 px-2 py-1.5 min-h-[44px] text-xs font-medium rounded-md border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  isWb
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-card text-muted-foreground border-border hover:border-blue-400'
                }`}
              >
                화이트보드
                <small data-testid="wb-subtext" className="block text-[10px] font-normal opacity-80">
                  {noSummary ? 'AI 회의록이 필요합니다' : wbSubtext}
                </small>
              </button>
            </span>
            <button
              onClick={() => setFormat('prompt')}
              className={`px-2 py-1.5 min-h-[44px] text-xs font-medium rounded-md border transition-colors ${
                format === 'prompt'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-card text-muted-foreground border-border hover:border-blue-400'
              }`}
            >
              프롬프트
            </button>
          </div>

          {format !== 'prompt' && !isWb && (
            <>
              <label className="flex items-center gap-2 text-sm text-foreground mb-2 cursor-pointer min-h-[44px]">
                <input
                  type="checkbox"
                  checked={includeSummary}
                  onChange={(e) => setIncludeSummary(e.target.checked)}
                  className="rounded"
                  aria-label="AI 요약 포함"
                />
                AI 요약 포함
              </label>

              <label className="flex items-center gap-2 text-sm text-foreground mb-2 cursor-pointer min-h-[44px]">
                <input
                  type="checkbox"
                  checked={includeMemo}
                  onChange={(e) => setIncludeMemo(e.target.checked)}
                  className="rounded"
                  aria-label="메모 포함"
                />
                메모 포함
              </label>

              <label className="flex items-center gap-2 text-sm text-foreground mb-4 cursor-pointer min-h-[44px]">
                <input
                  type="checkbox"
                  checked={includeTranscript}
                  onChange={(e) => setIncludeTranscript(e.target.checked)}
                  className="rounded"
                  aria-label="원본 텍스트 포함"
                />
                원본 텍스트 포함
              </label>
            </>
          )}

          {format === 'prompt' && (
            <p className="text-xs text-muted-foreground mb-4">
              시스템 프롬프트 + 자막 데이터를 포함한 텍스트 파일을 다운로드합니다.
              ChatGPT, Claude 등에 붙여넣어 회의록을 생성할 수 있습니다.
            </p>
          )}

          {isWb && (
            <div className="mb-4 space-y-2" data-testid="wb-body">
              {wbCopyMode ? (
                <>
                  {wbMaterial && (
                    <p className="rounded-md border border-blue-200 bg-blue-50 p-2 text-xs text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200" data-testid="wb-copy-notice">
                      {WB_COPY_NOTICE[wbCopyReason]}
                    </p>
                  )}
                  {copyState === 'idle' && (
                    <>
                      <p className="text-xs text-muted-foreground">
                        회의록과 작성 지시를 파일로 내려받습니다. 파일 내용을 Claude Code나 claude.ai에 붙여 넣으면 화이트보드 아티팩트를 만들어 줍니다.
                      </p>
                      {wbInstruction && (
                        <pre className="max-h-24 overflow-hidden whitespace-pre-wrap rounded-md bg-muted p-2 text-[11px] text-muted-foreground">
                          {wbInstruction.slice(0, 220)}…
                        </pre>
                      )}
                    </>
                  )}
                  {copyState === 'downloaded' && (
                    <>
                      <p className="text-sm text-green-600">지시문을 내려받았습니다. Claude Code나 claude.ai에 파일 내용을 붙여 넣어 주세요.</p>
                      <p className="text-xs text-amber-600">claude.ai에 붙여 넣으면 회의 내용이 내 claude.ai 계정으로 전달됩니다.</p>
                    </>
                  )}
                  {copyState === 'copied' && (
                    <>
                      <p className="text-sm text-green-600">지시문을 복사했습니다. Claude Code나 claude.ai에 붙여 넣어 주세요.</p>
                      <p className="text-xs text-amber-600">claude.ai에 붙여 넣으면 회의 내용이 내 claude.ai 계정으로 전달됩니다.</p>
                    </>
                  )}
                  {copyState === 'manual' && (
                    <>
                      <p className="text-xs text-muted-foreground">
                        자동 복사가 막혀 있습니다. 아래 지시문을 직접 복사해 Claude Code나 claude.ai에 붙여 넣어 주세요.
                      </p>
                      <textarea
                        ref={manualRef}
                        readOnly
                        value={wbInstruction}
                        aria-label="화이트보드 지시문"
                        onFocus={(e) => e.currentTarget.select()}
                        className="h-32 w-full rounded-md border border-border bg-muted p-2 text-[11px]"
                      />
                      <p className="text-xs text-amber-600">claude.ai에 붙여 넣으면 회의 내용이 내 claude.ai 계정으로 전달됩니다.</p>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleWhiteboardCopy()}
                    disabled={!wbLoaded || !wbMaterial}
                    className="w-full px-3 py-1.5 min-h-[36px] text-xs text-foreground border border-border rounded-md hover:bg-accent disabled:opacity-50"
                  >
                    복사
                  </button>
                </>
              ) : wbEntry.status === 'running' ? (
                <>
                  <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
                    <div className="h-full w-1/3 animate-pulse rounded bg-blue-600" />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {wbIsServer
                      ? '서버의 Claude Code가 화이트보드를 만드는 중입니다. 다른 화면으로 가도 계속 만들고, 끝나면 알려 드립니다.'
                      : '이 PC의 Claude Code가 화이트보드를 만드는 중입니다. 보통 1분 안에 끝납니다. 패널을 닫아도 계속 만들고, 끝나면 알려 드립니다.'}
                  </p>
                </>
              ) : wbEntry.status === 'done' ? (
                <>
                  <p className="text-sm text-green-600">
                    화이트보드를 만들었습니다. 저장할 위치를 골라 주세요.
                    <br />
                    <span className="font-mono text-xs break-all">{wbEntry.filename}</span>
                  </p>
                  {wbStale && (
                    <p className="text-xs text-amber-600" data-testid="wb-stale">
                      회의록이 바뀌었습니다. 다시 만들어 주세요.
                    </p>
                  )}
                  {wbEntry.saveError && <p className="text-xs text-red-500">{wbEntry.saveError}</p>}
                  {/* 서버 경로는 같은 회의록이면 서버가 캐시를 돌려주므로 stale 일 때만 다시 만들 수 있다. */}
                  {(wbEntry.source !== 'server' || wbStale) && (
                    <button
                      type="button"
                      onClick={() => {
                        resetWhiteboard(meetingId)
                        handleWhiteboardGenerate()
                      }}
                      disabled={!wbMaterial}
                      className="w-full px-3 py-1.5 min-h-[36px] text-xs text-foreground border border-border rounded-md hover:bg-accent disabled:opacity-50"
                    >
                      다시 만들기
                    </button>
                  )}
                </>
              ) : wbEntry.status === 'error' ? (
                <p className="text-sm text-red-500">{wbEntry.error}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {wbIsServer
                    ? 'AI 회의록만 읽고 서버 PC의 Claude Code로 만듭니다. 서버에 로그인된 계정의 사용량을 씁니다.'
                    : 'AI 회의록만 읽고 이 PC의 Claude Code로 만듭니다. 메모와 원본 텍스트는 넣지 않습니다.'}
                </p>
              )}
            </div>
          )}

          {error && (
            <p className="text-xs text-red-500 mb-2">{error}</p>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => setIsOpen(false)}
              className="flex-1 px-3 py-2 min-h-[44px] text-sm text-muted-foreground border border-border rounded-md hover:bg-accent"
            >
              {isWb && (wbBusy || wbDone) ? '닫기' : '취소'}
            </button>
            {isWb ? (
              <button
                onClick={() => {
                  if (wbCopyMode) {
                    void handleWhiteboardInstructionDownload()
                  } else if (wbEntry.status === 'done') {
                    void saveWhiteboard(meetingId)
                  } else {
                    if (wbEntry.status === 'error') resetWhiteboard(meetingId)
                    handleWhiteboardGenerate()
                  }
                }}
                disabled={wbCopyMode || wbEntry.status !== 'done' ? !wbLoaded || !wbMaterial || wbBusy : false}
                className="flex-1 px-3 py-2 min-h-[44px] text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {wbCopyMode
                  ? copyState === 'idle'
                    ? '지시문 내려받기 (.txt)'
                    : '다시 내려받기'
                  : wbEntry.status === 'running'
                    ? '만드는 중…'
                    : wbEntry.status === 'done'
                      ? '저장'
                      : wbEntry.status === 'error'
                        ? '다시 시도'
                        : '화이트보드 만들기'}
              </button>
            ) : (
              <button
                onClick={handleDownload}
                disabled={isDownloading}
                aria-label={isDownloading ? '다운로드 중...' : downloadLabel}
                className="flex-1 px-3 py-2 min-h-[44px] text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {isDownloading ? '다운로드 중...' : downloadLabel}
              </button>
            )}
          </div>

          {/* D'Flow로 전송 진입점 — 완료된 회의 + D'Flow 연동 활성화 시에만 노출 */}
          {meeting?.status === 'completed' && dflowEnabled && (
            <>
              <div className="my-3 border-t border-border" />
              <button
                type="button"
                onClick={() => {
                  setShowDflowDialog(true)
                  setIsOpen(false)
                }}
                className="flex w-full min-h-[44px] items-center justify-between rounded-md px-3 py-2 text-sm text-foreground hover:bg-accent"
              >
                <span>D'Flow로 전송</span>
                {meeting.dflow_needs_resync ? (
                  <span className="text-xs text-amber-600">재전송 필요</span>
                ) : meeting.dflow_synced_at ? (
                  <span className="text-xs text-muted-foreground">전송됨</span>
                ) : null}
              </button>
            </>
          )}
        </div>
      )}

      {showDflowDialog && meeting && (
        <SendToDflowDialog meeting={meeting} onClose={() => setShowDflowDialog(false)} onChanged={onChanged} />
      )}
    </div>
  )
}
