import { useState } from 'react'
import { FileText, FileSpreadsheet, FileImage, File, Link, Download, Trash2, ExternalLink } from 'lucide-react'
import type { MeetingAttachment } from '../../api/attachments'
import { getAttachmentDownloadUrl } from '../../api/attachments'

interface AttachmentCardProps {
  attachment: MeetingAttachment
  meetingId: number
  onDelete: (id: number) => void
}

function getFileIcon(contentType: string | null) {
  if (!contentType) return <File className="w-5 h-5 text-gray-400" />
  if (contentType.startsWith('image/')) return <FileImage className="w-5 h-5 text-purple-500" />
  if (contentType.includes('spreadsheet') || contentType.includes('excel') || contentType.includes('csv'))
    return <FileSpreadsheet className="w-5 h-5 text-green-600" />
  if (contentType.includes('pdf') || contentType.includes('document') || contentType.includes('text') || contentType.includes('word') || contentType.includes('hwp'))
    return <FileText className="w-5 h-5 text-blue-600" />
  return <File className="w-5 h-5 text-gray-400" />
}

function formatFileSize(bytes: number | null): string {
  if (bytes === null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function extractDomain(url: string | null): string {
  if (!url) return ''
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
}

export function AttachmentCard({ attachment, meetingId, onDelete }: AttachmentCardProps) {
  const [showConfirm, setShowConfirm] = useState(false)
  const isFile = attachment.kind === 'file'

  const handleClick = () => {
    if (isFile) {
      window.open(getAttachmentDownloadUrl(meetingId, attachment.id), '_blank')
    } else if (attachment.url) {
      window.open(attachment.url, '_blank', 'noopener,noreferrer')
    }
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (showConfirm) {
      onDelete(attachment.id)
      setShowConfirm(false)
    } else {
      setShowConfirm(true)
    }
  }

  const handleCancelDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowConfirm(false)
  }

  return (
    <div
      onClick={handleClick}
      className="group relative flex-shrink-0 w-[180px] h-[90px] rounded-lg border bg-white p-3 cursor-pointer hover:shadow-sm hover:border-blue-300 transition-all flex flex-col justify-between"
    >
      {/* 상단: 아이콘 + 이름 */}
      <div className="flex items-start gap-2 min-w-0">
        <div className="shrink-0 mt-0.5">
          {isFile ? getFileIcon(attachment.content_type) : <Link className="w-5 h-5 text-blue-500" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-gray-900 truncate" title={attachment.display_name}>
            {attachment.display_name}
          </p>
          <p className="text-[10px] text-gray-400 truncate">
            {isFile ? formatFileSize(attachment.file_size) : extractDomain(attachment.url)}
          </p>
        </div>
      </div>

      {/* 하단: 날짜 */}
      <p className="text-[10px] text-gray-400">{formatDate(attachment.created_at)}</p>

      {/* hover 시 액션 버튼 */}
      <div className="absolute top-1.5 right-1.5 hidden group-hover:flex items-center gap-0.5">
        {showConfirm ? (
          <>
            <button
              onClick={handleDelete}
              className="p-1 rounded bg-red-500 text-white hover:bg-red-600 transition-colors"
              title="삭제 확인"
            >
              <Trash2 className="w-3 h-3" />
            </button>
            <button
              onClick={handleCancelDelete}
              className="p-1 rounded bg-gray-200 text-gray-600 hover:bg-gray-300 transition-colors text-[10px] px-1.5"
            >
              취소
            </button>
          </>
        ) : (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleClick()
              }}
              className="p-1 rounded bg-white/90 text-gray-500 hover:text-blue-600 hover:bg-blue-50 transition-colors shadow-sm border"
              title={isFile ? '다운로드' : '열기'}
            >
              {isFile ? <Download className="w-3 h-3" /> : <ExternalLink className="w-3 h-3" />}
            </button>
            <button
              onClick={handleDelete}
              className="p-1 rounded bg-white/90 text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors shadow-sm border"
              title="삭제"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
