import { useState } from 'react'
import { FileText, FileSpreadsheet, FileImage, File, Link, Download, Trash2, ExternalLink } from 'lucide-react'
import type { MeetingAttachment } from '../../api/attachments'
import apiClient from '../../api/client'
import { downloadBlob } from '../../lib/download'
import { Dialog } from '../ui/Dialog'

interface AttachmentCardProps {
  attachment: MeetingAttachment
  meetingId: number
  onDelete: (id: number) => void
  /** 잠긴 회의면 삭제 버튼을 숨긴다 (열기·다운로드는 가능). 기본 false. */
  readOnly?: boolean
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

export function AttachmentCard({ attachment, meetingId, onDelete, readOnly = false }: AttachmentCardProps) {
  const [showConfirm, setShowConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [viewerUrl, setViewerUrl] = useState<string | null>(null)
  const isFile = attachment.kind === 'file'
  const isImage = isFile && (attachment.content_type?.startsWith('image/') ?? false)
  const saveName = attachment.original_filename || attachment.display_name || `attachment-${attachment.id}`

  // 다운로드 엔드포인트는 authenticate_user! 가 걸려 있어 window.open(raw URL)은 폰(원격)에서
  // Authorization 헤더가 없어 401이 난다. apiClient로 가져오면 JWT 주입 + 401 자동 refresh가 적용되고,
  // 맥 본체 loopback(로컬 admin)에서도 동일하게 동작한다.
  const fetchBlob = async (): Promise<Blob> => {
    const res = await apiClient.get(`meetings/${meetingId}/attachments/${attachment.id}/download`)
    return res.blob()
  }

  // 카드 탭: 이미지면 인앱 뷰어, 그 외 파일은 저장. Tauri webview는 raw URL을 뷰어로 못 열어
  // 이미지는 blob objectURL을 <img>로 직접 띄운다.
  const handleOpen = async () => {
    if (!isFile) {
      if (attachment.url) window.open(attachment.url, '_blank', 'noopener,noreferrer')
      return
    }
    if (busy) return
    setBusy(true)
    setErrMsg(null)
    try {
      const blob = await fetchBlob()
      if (isImage) {
        setViewerUrl(URL.createObjectURL(blob))
      } else {
        await downloadBlob(blob, saveName)
      }
    } catch {
      setErrMsg('파일을 열 수 없습니다')
    } finally {
      setBusy(false)
    }
  }

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!isFile) {
      handleOpen()
      return
    }
    if (busy) return
    setBusy(true)
    setErrMsg(null)
    try {
      const blob = await fetchBlob()
      await downloadBlob(blob, saveName)
    } catch {
      setErrMsg('다운로드 실패')
    } finally {
      setBusy(false)
    }
  }

  const closeViewer = () => {
    if (viewerUrl) URL.revokeObjectURL(viewerUrl)
    setViewerUrl(null)
  }

  // 뷰어 안 다운로드 버튼: 이미 받은 objectURL을 재사용(서버 재요청 없음)
  const downloadFromViewer = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!viewerUrl) return
    const blob = await (await fetch(viewerUrl)).blob()
    await downloadBlob(blob, saveName)
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
    <>
    <div
      onClick={handleOpen}
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

      {/* 하단: 날짜 / 상태 */}
      <p className="text-[10px] text-gray-400">
        {busy ? '여는 중...' : errMsg ? <span className="text-red-500">{errMsg}</span> : formatDate(attachment.created_at)}
      </p>

      {/* hover 시 액션 버튼 */}
      <div className="absolute top-1.5 right-1.5 hidden hover-show-flex-parent items-center gap-2">
        {readOnly ? (
          <button
            onClick={handleDownload}
            disabled={busy}
            className="p-2 rounded bg-white/90 text-gray-500 hover:text-blue-600 hover:bg-blue-50 transition-colors shadow-sm border disabled:opacity-50"
            title={isFile ? '다운로드' : '열기'}
          >
            {isFile ? <Download className="w-3 h-3" /> : <ExternalLink className="w-3 h-3" />}
          </button>
        ) : showConfirm ? (
          <>
            <button
              onClick={handleDelete}
              className="p-2 rounded bg-red-500 text-white hover:bg-red-600 transition-colors"
              title="삭제 확인"
            >
              <Trash2 className="w-3 h-3" />
            </button>
            <button
              onClick={handleCancelDelete}
              className="p-2 rounded bg-gray-200 text-gray-600 hover:bg-gray-300 transition-colors text-[10px] px-2"
            >
              취소
            </button>
          </>
        ) : (
          <>
            <button
              onClick={handleDownload}
              disabled={busy}
              className="p-2 rounded bg-white/90 text-gray-500 hover:text-blue-600 hover:bg-blue-50 transition-colors shadow-sm border disabled:opacity-50"
              title={isFile ? '다운로드' : '열기'}
            >
              {isFile ? <Download className="w-3 h-3" /> : <ExternalLink className="w-3 h-3" />}
            </button>
            <button
              onClick={handleDelete}
              className="p-2 rounded bg-white/90 text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors shadow-sm border"
              title="삭제"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </>
        )}
      </div>
    </div>

    {viewerUrl && (
      <Dialog onClose={closeViewer} className="max-w-3xl w-full bg-white rounded-xl p-4 shadow-2xl">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium text-gray-800 truncate" title={attachment.display_name}>
            {attachment.display_name}
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={downloadFromViewer}
              className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
            >
              <Download className="w-3.5 h-3.5" /> 다운로드
            </button>
            <button
              onClick={closeViewer}
              className="rounded-md border px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
            >
              닫기
            </button>
          </div>
        </div>
        <img
          src={viewerUrl}
          alt={attachment.display_name}
          className="max-h-[75vh] max-w-full mx-auto rounded object-contain"
        />
      </Dialog>
    )}
    </>
  )
}
