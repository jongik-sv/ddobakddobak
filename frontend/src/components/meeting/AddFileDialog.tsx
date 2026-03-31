import { useState } from 'react'
import { createFileAttachment } from '../../api/attachments'
import type { AttachmentCategory } from '../../api/attachments'
import { IS_TAURI } from '../../config'

const ACCEPTED_FILE_TYPES = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.md,.png,.jpg,.jpeg,.gif,.webp,.zip,.hwp'

const CATEGORIES: { value: AttachmentCategory; label: string }[] = [
  { value: 'agenda', label: '안건' },
  { value: 'reference', label: '참고자료' },
  { value: 'minutes', label: '첨부' },
]

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
      const name = filePath.split('/').pop() ?? 'file'
      const nativeFile = new File([bytes], name)
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

    for (let i = 0; i < files.length; i++) {
      if (files[i].status === 'done') continue
      setFiles((prev) => prev.map((f, idx) => (idx === i ? { ...f, status: 'uploading', progress: 50 } : f)))
      try {
        await createFileAttachment(meetingId, category, files[i].file)
        setFiles((prev) => prev.map((f, idx) => (idx === i ? { ...f, status: 'done', progress: 100 } : f)))
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '업로드 실패'
        setFiles((prev) => prev.map((f, idx) => (idx === i ? { ...f, status: 'error', error: msg } : f)))
      }
    }

    setUploading(false)
    onUploaded()
    onClose()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl border border-gray-100">
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
            accept={ACCEPTED_FILE_TYPES}
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
          <p className="text-xs text-gray-400 mt-1">PDF, DOC, XLS, PPT, 이미지, ZIP, HWP 등</p>
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
      </div>
    </div>
  )
}
