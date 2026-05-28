import { useState } from 'react'
import { HTTPError } from 'ky'
import { changePassword } from '../../api/account'
import { useAuthStore } from '../../stores/authStore'

export default function PasswordChangeSection() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    if (next !== confirm) {
      setError('새 비밀번호가 일치하지 않습니다.')
      return
    }

    setSaving(true)
    try {
      const tokens = await changePassword({
        current_password: current,
        new_password: next,
        new_password_confirmation: confirm,
      })
      useAuthStore.getState().setTokens(tokens.access_token, tokens.refresh_token)
      setCurrent('')
      setNext('')
      setConfirm('')
      setSuccess('비밀번호가 변경되었습니다. 다른 기기는 다시 로그인해야 합니다.')
    } catch (err) {
      if (err instanceof HTTPError) {
        const body = (await err.response.json().catch(() => ({}))) as { error?: string; errors?: string[] }
        setError(body.error ?? body.errors?.join(', ') ?? '비밀번호 변경에 실패했습니다.')
      } else {
        setError('비밀번호 변경에 실패했습니다.')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border bg-card p-6">
      <h2 className="text-lg font-semibold mb-1">비밀번호 변경</h2>
      <p className="text-sm text-muted-foreground mb-4">
        변경하면 현재 기기를 제외한 모든 로그인 세션이 만료됩니다.
      </p>
      <form onSubmit={handleSubmit} className="space-y-3 max-w-sm">
        <div>
          <label htmlFor="current-password" className="block text-sm font-medium mb-1">현재 비밀번호</label>
          <input
            id="current-password"
            type="password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
          />
        </div>
        <div>
          <label htmlFor="new-password" className="block text-sm font-medium mb-1">새 비밀번호</label>
          <input
            id="new-password"
            type="password"
            required
            minLength={6}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            placeholder="6자 이상"
            className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
          />
        </div>
        <div>
          <label htmlFor="confirm-password" className="block text-sm font-medium mb-1">새 비밀번호 확인</label>
          <input
            id="confirm-password"
            type="password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && <p className="text-sm text-green-600">{success}</p>}
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors min-h-[44px]"
        >
          {saving ? '변경 중...' : '비밀번호 변경'}
        </button>
      </form>
    </div>
  )
}
