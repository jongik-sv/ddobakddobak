import { useState, useRef, useEffect } from 'react'
import { exportMeeting } from '../../api/meetings'
import { downloadMarkdown, buildMarkdownFilename } from '../../lib/markdown'

interface ExportButtonProps {
  meetingId: number
  /**
   * meeting.started_at 또는 meeting.created_at — 파일명 날짜에 사용
   * 없으면 오늘 날짜 사용
   */
  meetingDate?: string | null
}

export function ExportButton({ meetingId, meetingDate }: ExportButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [includeSummary, setIncludeSummary] = useState(true)
  const [includeTranscript, setIncludeTranscript] = useState(true)
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

  const handleDownload = async () => {
    setIsDownloading(true)
    setError(null)
    try {
      const content = await exportMeeting(meetingId, {
        include_summary: includeSummary,
        include_transcript: includeTranscript,
      })
      const filename = buildMarkdownFilename(meetingId, meetingDate ?? undefined)
      downloadMarkdown(content, filename)
      setIsOpen(false)
    } catch {
      setError('내보내기에 실패했습니다. 다시 시도해 주세요.')
    } finally {
      setIsDownloading(false)
    }
  }

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
        <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg p-4 z-10">
          <p className="text-sm font-medium text-gray-800 mb-3">Markdown 내보내기</p>

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
              aria-label={isDownloading ? '다운로드 중...' : '다운로드 .md'}
              className="flex-1 px-3 py-1.5 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {isDownloading ? '다운로드 중...' : '다운로드 .md'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
