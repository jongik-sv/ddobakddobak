import { useState } from 'react'
import { HTTPError } from 'ky'
import { UserPlus } from 'lucide-react'
import { createAdminUser } from '../../api/adminUsers'
import type { AdminUser } from '../../api/adminUsers'

/** 사용자 생성 다이얼로그 */
export function CreateUserDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (user: AdminUser) => void
}) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'member' | 'admin'>('member')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const user = await createAdminUser({ email, name, password, role })
      onCreated(user)
    } catch (err) {
      if (err instanceof HTTPError) {
        const body = await err.response.json().catch(() => ({})) as Record<string, string[]>
        setError(body.errors?.join(', ') ?? '사용자 생성에 실패했습니다.')
      } else {
        setError('사용자 생성에 실패했습니다.')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-xl bg-white shadow-2xl border border-gray-100 p-6 mx-4"
      >
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <UserPlus className="w-5 h-5" />
          사용자 추가
        </h3>

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">이메일</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">이름</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="홍길동"
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">비밀번호</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="6자 이상"
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">역할</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as 'admin' | 'member')}
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white min-h-[44px]"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-md text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors min-h-[44px]"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors min-h-[44px]"
          >
            {saving ? '생성 중...' : '생성'}
          </button>
        </div>
      </form>
    </div>
  )
}
