import { useState } from 'react'
import { HTTPError } from 'ky'
import { updateAdminUser } from '../../api/adminUsers'
import type { AdminUser } from '../../api/adminUsers'

/** 사용자 편집(이름/이메일) 다이얼로그 */
export function EditUserDialog({
  user,
  onClose,
  onUpdated,
}: {
  user: AdminUser
  onClose: () => void
  onUpdated: (u: AdminUser) => void
}) {
  const [name, setName] = useState(user.name)
  const [email, setEmail] = useState(user.email)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const updated = await updateAdminUser(user.id, { name, email })
      onUpdated(updated)
    } catch (err) {
      if (err instanceof HTTPError) {
        const body = (await err.response.json().catch(() => ({}))) as { errors?: string[]; error?: string }
        setError(body.errors?.join(', ') ?? body.error ?? '수정에 실패했습니다.')
      } else {
        setError('수정에 실패했습니다.')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
      <form onSubmit={handleSubmit} className="w-full max-w-md rounded-xl bg-card shadow-2xl border border-border p-6 mx-4">
        <h3 className="text-lg font-semibold mb-4">사용자 수정</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">이름</label>
            <input type="text" required value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">이메일</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]" />
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-md text-sm font-medium border border-border text-foreground hover:bg-accent min-h-[44px]">취소</button>
          <button type="submit" disabled={saving} className="px-4 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 min-h-[44px]">
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </form>
    </div>
  )
}
