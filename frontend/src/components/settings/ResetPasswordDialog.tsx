import { useState } from 'react'
import { resetAdminUserPassword } from '../../api/adminUsers'
import type { AdminUser } from '../../api/adminUsers'

/** 사용자 비밀번호 초기화 다이얼로그 — 임시 비밀번호 발급 + 복사 */
export function ResetPasswordDialog({
  user,
  onClose,
}: {
  user: AdminUser
  onClose: () => void
}) {
  const [working, setWorking] = useState(false)
  const [temp, setTemp] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const handleReset = async () => {
    setWorking(true)
    setError(null)
    try {
      const res = await resetAdminUserPassword(user.id)
      setTemp(res.temp_password)
    } catch {
      setError('비밀번호 초기화에 실패했습니다.')
    } finally {
      setWorking(false)
    }
  }

  const handleCopy = async () => {
    if (!temp) return
    await navigator.clipboard.writeText(temp)
    setCopied(true)
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
      <div className="w-full max-w-sm rounded-xl bg-card shadow-2xl border border-border p-6 mx-4">
        <h3 className="text-lg font-semibold mb-2">비밀번호 초기화</h3>
        {temp === null ? (
          <>
            <p className="text-sm text-muted-foreground mb-4">
              <strong>{user.name}</strong> ({user.email})의 비밀번호를 임시 비밀번호로 재설정합니다.
              해당 사용자의 모든 세션이 만료됩니다.
            </p>
            {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="px-4 py-2 rounded-md text-sm font-medium border border-border text-foreground hover:bg-accent min-h-[44px]">취소</button>
              <button onClick={handleReset} disabled={working} className="px-4 py-2 rounded-md text-sm font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 min-h-[44px]">
                {working ? '처리 중...' : '초기화'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground mb-3">
              임시 비밀번호입니다. 이 창을 닫으면 다시 볼 수 없으니 사용자에게 전달하세요.
            </p>
            <div className="flex items-center gap-2 mb-4">
              <code className="flex-1 rounded-md bg-muted px-3 py-2 text-sm font-mono break-all">{temp}</code>
              <button onClick={handleCopy} className="px-3 py-2 rounded-md text-sm font-medium border border-border hover:bg-accent min-h-[44px]">
                {copied ? '복사됨' : '복사'}
              </button>
            </div>
            <div className="flex justify-end">
              <button onClick={onClose} className="px-4 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 min-h-[44px]">닫기</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
