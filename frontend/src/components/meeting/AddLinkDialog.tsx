import { useState } from 'react'
import { createLinkAttachment } from '../../api/attachments'
import type { AttachmentCategory } from '../../api/attachments'

const CATEGORIES: { value: AttachmentCategory; label: string }[] = [
  { value: 'agenda', label: '안건' },
  { value: 'reference', label: '참고자료' },
  { value: 'minutes', label: '첨부' },
]

interface AddLinkDialogProps {
  meetingId: number
  defaultCategory: AttachmentCategory
  onClose: () => void
  onAdded: () => void
}

function isValidUrl(str: string): boolean {
  return /^https?:\/\/.+/.test(str)
}

export function AddLinkDialog({ meetingId, defaultCategory, onClose, onAdded }: AddLinkDialogProps) {
  const [category, setCategory] = useState<AttachmentCategory>(defaultCategory)
  const [url, setUrl] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isValidUrl(url)) {
      setError('올바른 URL을 입력하세요 (http:// 또는 https://)')
      return
    }
    setLoading(true)
    setError('')
    try {
      await createLinkAttachment(meetingId, category, url, displayName || undefined)
      onAdded()
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '링크 추가에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl border border-gray-100">
        <h2 className="text-lg font-semibold mb-4">링크 추가</h2>

        {error && (
          <div role="alert" className="rounded-md bg-destructive/10 px-4 py-2 text-sm text-destructive mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 카테고리 선택 */}
          <div>
            <label className="block text-sm font-medium mb-2">카테고리</label>
            <div className="flex flex-wrap gap-2">
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
          </div>

          {/* URL 입력 */}
          <div>
            <label className="block text-sm font-medium mb-1">URL</label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/document"
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              autoFocus
            />
          </div>

          {/* 제목 입력 */}
          <div>
            <label className="block text-sm font-medium mb-1">제목 (선택)</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="링크 제목을 입력하세요"
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* 하단 버튼 */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={loading || !url.trim()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {loading ? '추가 중...' : '추가'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
