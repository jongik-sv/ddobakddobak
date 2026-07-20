import { useState, useRef, useEffect } from 'react'
import { Download } from 'lucide-react'
import { exportMeeting, exportMeetingData, exportPrompt, getMeeting } from '../../api/meetings'
import type { Meeting } from '../../api/meetings'
import { getDflowSettings } from '../../api/dflow'
import { downloadMarkdown } from '../../lib/markdown'
import { downloadBlob, downloadText } from '../../lib/download'
import { Tooltip } from '../ui/Tooltip'
import { ACTION_NEUTRAL } from './actionButtonStyles'
import SendToDflowDialog from './SendToDflowDialog'

type ExportFormat = 'md' | 'pdf' | 'docx' | 'prompt'

interface ExportButtonProps {
  meetingId: number
  meetingTitle?: string
  meetingDate?: string | null
}

/** 파일명에 사용할 수 없는 문자를 제거하고 안전한 이름을 만든다 */
function sanitizeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '').replace(/\s+/g, '_').slice(0, 100)
}

function buildExportFilename(title: string | undefined, format: ExportFormat, date?: string | Date): string {
  const d = date ? new Date(date) : new Date()
  const dateStr = d.toISOString().slice(0, 10)
  const baseName = title ? sanitizeFilename(title) : 'meeting'
  const ext = format === 'prompt' ? 'txt' : format
  return `${baseName}_${dateStr}.${ext}`
}

export function ExportButton({ meetingId, meetingTitle, meetingDate }: ExportButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [format, setFormat] = useState<ExportFormat>('md')
  const [includeSummary, setIncludeSummary] = useState(true)
  const [includeMemo, setIncludeMemo] = useState(true)
  const [includeTranscript, setIncludeTranscript] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // D'Flow 진입점: 패널 열릴 때마다 최신 회의 상태(status·folder_path·dflow_*)와 연동 활성화
  // 여부를 조회한다. MeetingActions.tsx가 이미 들고 있는 meeting을 내려받지 않고(진입점 변경
  // 범위를 ExportButton 내부로 한정) 자체 조회 — 패널을 여는 사용자 액션 빈도가 낮아 비용 작음.
  const [dflowMeeting, setDflowMeeting] = useState<Meeting | null>(null)
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
    Promise.all([getMeeting(meetingId), getDflowSettings()])
      .then(([meeting, settings]) => {
        if (cancelled) return
        setDflowMeeting(meeting)
        setDflowEnabled(settings.enabled)
      })
      .catch(() => {
        // 실패 시 항목을 숨긴다(fail-closed) — 노출 조건을 확인할 수 없으면 노출하지 않음.
        if (cancelled) return
        setDflowMeeting(null)
        setDflowEnabled(false)
      })
    return () => {
      cancelled = true
    }
  }, [isOpen, meetingId])

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

  const downloadLabel = format === 'prompt' ? '다운로드 .txt' : `다운로드 .${format}`

  return (
    <div className="relative" ref={panelRef}>
      {/* 트리거 버튼 — Tooltip은 트리거만 감싼다(아래 드롭다운 패널은 relative div의 형제로 유지해 앵커 위치 보존) */}
      <Tooltip text="내보내기">
        <button
          onClick={() => setIsOpen((o) => !o)}
          className={ACTION_NEUTRAL}
          aria-label="내보내기"
        >
          <Download className="w-4 h-4" />
          <span className="hidden lg:inline">내보내기</span>
        </button>
      </Tooltip>

      {/* 옵션 패널 — D'Flow 구획을 위해 w-80(320px)으로 확대(기존 w-64) */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-1 w-80 bg-card border border-border rounded-lg shadow-lg p-4 z-50">
          <p className="text-sm font-medium text-foreground mb-3">회의록 내보내기</p>

          {/* 형식 선택 */}
          <div className="flex gap-1.5 mb-3">
            {(['md', 'pdf', 'docx', 'prompt'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFormat(f)}
                className={`flex-1 px-2 py-1.5 min-h-[44px] text-xs font-medium rounded-md border transition-colors ${
                  format === f
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-card text-muted-foreground border-border hover:border-blue-400'
                }`}
              >
                {f === 'prompt' ? '프롬프트' : `.${f}`}
              </button>
            ))}
          </div>

          {format !== 'prompt' && (
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

          {error && (
            <p className="text-xs text-red-500 mb-2">{error}</p>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => setIsOpen(false)}
              className="flex-1 px-3 py-2 min-h-[44px] text-sm text-muted-foreground border border-border rounded-md hover:bg-accent"
            >
              취소
            </button>
            <button
              onClick={handleDownload}
              disabled={isDownloading}
              aria-label={isDownloading ? '다운로드 중...' : downloadLabel}
              className="flex-1 px-3 py-2 min-h-[44px] text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {isDownloading ? '다운로드 중...' : downloadLabel}
            </button>
          </div>

          {/* D'Flow로 전송 진입점 — 완료된 회의 + D'Flow 연동 활성화 시에만 노출 */}
          {dflowMeeting?.status === 'completed' && dflowEnabled && (
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
                {dflowMeeting.dflow_needs_resync ? (
                  <span className="text-xs text-amber-600">재전송 필요</span>
                ) : dflowMeeting.dflow_synced_at ? (
                  <span className="text-xs text-muted-foreground">전송됨</span>
                ) : null}
              </button>
            </>
          )}
        </div>
      )}

      {showDflowDialog && dflowMeeting && (
        <SendToDflowDialog meeting={dflowMeeting} onClose={() => setShowDflowDialog(false)} />
      )}
    </div>
  )
}
