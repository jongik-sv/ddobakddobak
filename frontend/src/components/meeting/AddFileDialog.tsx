import { useState } from 'react'
import { createFileAttachment } from '../../api/attachments'
import type { AttachmentCategory } from '../../api/attachments'
import { IS_TAURI } from '../../config'
import { errorToMessage } from '../../lib/errors'
import { notifyContactsChanged } from '../../hooks/useContacts'
import { Dialog } from '../ui/Dialog'

const ACCEPTED_FILE_TYPES = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.md,.png,.jpg,.jpeg,.gif,.webp,.zip,.hwp'

// 확장자 → MIME. Tauri readFile로 만든 File은 type이 비어 있어 서버 ALLOWED_CONTENT_TYPES
// 검사에서 거부된다(파일 업로드 안 되던 원인). 확장자로 MIME을 채워 보낸다.
const EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  csv: 'text/csv',
  md: 'text/markdown',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  zip: 'application/zip',
  hwp: 'application/x-hwp',
}

function mimeForName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return EXT_MIME[ext] ?? 'application/octet-stream'
}

// Android 사진/문서 선택 시 content URI의 document-id(예: image:1000010980)가 파일명으로 와
// 확장자가 없다 → mimeForName이 octet-stream을 내고 서버 ALLOWED_CONTENT_TYPES에서 거부된다.
// 바이트 시그니처(매직넘버)로 실제 형식을 판별해 MIME과 확장자를 보강한다.
function sniffSignature(bytes: Uint8Array): { ext: string; mime: string } | null {
  const b = bytes
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: 'png', mime: 'image/png' }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' }
  if (b.length >= 3 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { ext: 'gif', mime: 'image/gif' }
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { ext: 'webp', mime: 'image/webp' }
  if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return { ext: 'pdf', mime: 'application/pdf' }
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05)) return { ext: 'zip', mime: 'application/zip' }
  return null
}

const CATEGORIES: { value: AttachmentCategory; label: string }[] = [
  { value: 'agenda', label: '안건' },
  { value: 'reference', label: '참고자료' },
  { value: 'minutes', label: '첨부' },
  { value: 'business_card', label: '명함' },
]

const IMAGE_ONLY_TYPES = '.png,.jpg,.jpeg,.webp'

interface AddFileDialogProps {
  meetingId: number
  defaultCategory: AttachmentCategory
  onClose: () => void
  onUploaded: () => void
}

interface FileItem {
  file: File
  progress: number
  status: 'pending' | 'uploading' | 'done' | 'error'
  error?: string
}

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function AddFileDialog({ meetingId, defaultCategory, onClose, onUploaded }: AddFileDialogProps) {
  const [category, setCategory] = useState<AttachmentCategory>(defaultCategory)
  const [files, setFiles] = useState<FileItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [cardProcessing, setCardProcessing] = useState(false)

  const addFiles = (newFiles: File[]) => {
    setFiles((prev) => [
      ...prev,
      ...newFiles.map((f) => ({ file: f, progress: 0, status: 'pending' as const })),
    ])
  }

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const dropped = Array.from(e.dataTransfer.files)
    if (dropped.length > 0) addFiles(dropped)
  }

  const handleTauriFileSelect = async () => {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({
      multiple: true,
      filters: [{
        name: 'Files',
        extensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'md', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'zip', 'hwp'],
      }],
    })
    if (!selected) return
    const paths = Array.isArray(selected) ? selected : [selected]
    const { readFile } = await import('@tauri-apps/plugin-fs')
    const nativeFiles: File[] = []
    for (const filePath of paths) {
      if (typeof filePath !== 'string') continue
      const bytes = await readFile(filePath)
      // content URI라 %3A(=:) 등이 인코딩돼 올 수 있어 디코드. 실패해도 원본 유지.
      let name = filePath.split('/').pop() ?? 'file'
      try { name = decodeURIComponent(name) } catch { /* keep raw */ }
      let mime = mimeForName(name)
      if (mime === 'application/octet-stream') {
        const hit = sniffSignature(bytes)
        if (hit) {
          mime = hit.mime
          // 확장자가 없거나 알 수 없으면 시그니처 기준으로 보강 (파일명 콜론은 _로 치환)
          if (!name.toLowerCase().endsWith(`.${hit.ext}`)) name = `${name.replace(/[:/\\]/g, '_')}.${hit.ext}`
        }
      }
      const nativeFile = new File([bytes], name, { type: mime })
      nativeFiles.push(nativeFile)
    }
    if (nativeFiles.length > 0) addFiles(nativeFiles)
  }

  const handleDropZoneClick = () => {
    if (IS_TAURI) {
      handleTauriFileSelect()
    } else {
      document.getElementById('attachment-file-input')?.click()
    }
  }

  const handleUpload = async () => {
    if (files.length === 0) return
    setUploading(true)

    let anyError = false
    let anyCardSuccess = false
    for (let i = 0; i < files.length; i++) {
      if (files[i].status === 'done') continue
      setFiles((prev) => prev.map((f, idx) => (idx === i ? { ...f, status: 'uploading', progress: 50 } : f)))
      try {
        await createFileAttachment(meetingId, category, files[i].file)
        setFiles((prev) => prev.map((f, idx) => (idx === i ? { ...f, status: 'done', progress: 100 } : f)))
        if (category === 'business_card') anyCardSuccess = true
      } catch (err: unknown) {
        anyError = true
        const msg = await errorToMessage(err, '업로드 실패')
        setFiles((prev) => prev.map((f, idx) => (idx === i ? { ...f, status: 'error', error: msg } : f)))
      }
    }

    setUploading(false)
    onUploaded()
    if (anyCardSuccess) {
      // 명함 인식은 서버 비동기 — 패널은 ActionCable로 갱신되지만, 누락 대비 지연 refetch도 쏜다.
      setCardProcessing(true)
      ;[3000, 7000, 12000].forEach((ms) => setTimeout(() => notifyContactsChanged(meetingId), ms))
    }
    // 실패가 있거나 명함 인식 중이면 다이얼로그를 닫지 않는다(사용자가 상태를 보게).
    if (!anyError && !anyCardSuccess) onClose()
  }

  return (
    <Dialog onClose={onClose}>
        <h2 className="text-lg font-semibold mb-4">파일 첨부</h2>

        {/* 카테고리 선택 */}
        <div className="flex flex-wrap gap-2 mb-4">
          {CATEGORIES.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setCategory(c.value)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                category === c.value
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* 드롭존 */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={handleDropZoneClick}
          className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors mb-4 ${
            dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
          }`}
        >
          <input
            id="attachment-file-input"
            type="file"
            accept={category === 'business_card' ? IMAGE_ONLY_TYPES : ACCEPTED_FILE_TYPES}
            multiple
            onChange={(e) => {
              if (e.target.files) addFiles(Array.from(e.target.files))
              e.target.value = ''
            }}
            className="hidden"
          />
          <svg className="w-8 h-8 mx-auto text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <p className="text-sm text-gray-600">파일을 드래그하거나 클릭하여 선택</p>
          <p className="text-xs text-gray-400 mt-1">
            {category === 'business_card'
              ? '명함 이미지를 올리면 자동 인식되어 참석자로 등록됩니다 (PNG/JPG/WEBP)'
              : 'PDF, DOC, XLS, PPT, 이미지, ZIP, HWP 등'}
          </p>
        </div>

        {/* 파일 목록 */}
        {files.length > 0 && (
          <div className="max-h-40 overflow-y-auto space-y-2 mb-4">
            {files.map((item, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="truncate flex-1 text-gray-700">{item.file.name}</span>
                <span className="text-xs text-gray-400 shrink-0">{formatSize(item.file.size)}</span>
                {item.status === 'uploading' && (
                  <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden shrink-0">
                    <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${item.progress}%` }} />
                  </div>
                )}
                {item.status === 'done' && <span className="text-green-500 text-xs shrink-0">완료</span>}
                {item.status === 'error' && <span className="text-red-500 text-xs shrink-0" title={item.error}>실패</span>}
                {item.status === 'pending' && (
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    className="text-gray-400 hover:text-gray-600 shrink-0"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {cardProcessing && (
          <p className="mb-3 text-sm text-blue-600">
            명함 인식 중… 잠시 후 참석자(명함) 패널에 표시됩니다. 이 창은 닫아도 됩니다.
          </p>
        )}

        {/* 하단 버튼 */}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleUpload}
            disabled={uploading || files.length === 0}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {uploading ? '업로드 중...' : `업로드 (${files.length})`}
          </button>
        </div>
    </Dialog>
  )
}
