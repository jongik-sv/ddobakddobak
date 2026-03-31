import { useState, useRef, useEffect } from 'react'
import { exportMeeting, exportMeetingData, exportPrompt } from '../../api/meetings'
import { downloadMarkdown } from '../../lib/markdown'
import { downloadBlob, downloadText } from '../../lib/download'

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
      {/* 트리거 버튼 */}
      <button
        onClick={() => setIsOpen((o) => !o)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
        aria-label="내보내기"
      >
        <span>↓</span>
        <span>내보내기</span>
      </button>

      {/* 옵션 패널 */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg p-4 z-10">
          <p className="text-sm font-medium text-gray-800 mb-3">회의록 내보내기</p>

          {/* 형식 선택 */}
          <div className="flex gap-1.5 mb-3">
            {(['md', 'pdf', 'docx', 'prompt'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFormat(f)}
                className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                  format === f
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
                }`}
              >
                {f === 'prompt' ? '프롬프트' : `.${f}`}
              </button>
            ))}
          </div>

          {format !== 'prompt' && (
            <>
              <label className="flex items-center gap-2 text-sm text-gray-700 mb-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeSummary}
                  onChange={(e) => setIncludeSummary(e.target.checked)}
                  className="rounded"
                  aria-label="AI 요약 포함"
                />
                AI 요약 포함
              </label>

              <label className="flex items-center gap-2 text-sm text-gray-700 mb-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeMemo}
                  onChange={(e) => setIncludeMemo(e.target.checked)}
                  className="rounded"
                  aria-label="메모 포함"
                />
                메모 포함
              </label>

              <label className="flex items-center gap-2 text-sm text-gray-700 mb-4 cursor-pointer">
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
            <p className="text-xs text-gray-500 mb-4">
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
              className="flex-1 px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50"
            >
              취소
            </button>
            <button
              onClick={handleDownload}
              disabled={isDownloading}
              aria-label={isDownloading ? '다운로드 중...' : downloadLabel}
              className="flex-1 px-3 py-1.5 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {isDownloading ? '다운로드 중...' : downloadLabel}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
