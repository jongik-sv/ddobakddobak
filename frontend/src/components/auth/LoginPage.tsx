import { useState } from 'react'
import { LogIn } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { getApiOrigin, IS_MOBILE, IS_TAURI } from '../../config'

export function LoginPage() {
  const { login, loginDirect } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await loginDirect(email, password)
    } catch {
      setError('이메일 또는 비밀번호가 올바르지 않습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-muted to-background flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-card rounded-2xl shadow-lg p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-foreground mb-2">또박또박</h1>
          <p className="text-muted-foreground">AI 회의록 - 로그인이 필요합니다</p>
          {IS_TAURI && getApiOrigin() && (
            <p className="mt-2 text-xs text-muted-foreground break-all">서버: {getApiOrigin()}</p>
          )}
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 mb-6">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-foreground mb-1">
              이메일
            </label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              autoFocus
              className="w-full px-4 py-3 border border-border rounded-lg
                         focus:ring-2 focus:ring-blue-500 focus:border-blue-500
                         transition-colors text-foreground placeholder-muted-foreground"
              placeholder="name@company.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-foreground mb-1">
              비밀번호
            </label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full px-4 py-3 border border-border rounded-lg
                         focus:ring-2 focus:ring-blue-500 focus:border-blue-500
                         transition-colors text-foreground placeholder-muted-foreground"
              placeholder="비밀번호 입력"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-3
                       rounded-xl bg-blue-600 text-white font-semibold
                       hover:bg-blue-700 transition-colors cursor-pointer
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <LogIn className="w-5 h-5" />
            {loading ? '로그인 중...' : '로그인'}
          </button>
        </form>

        <div className="relative mb-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-card text-muted-foreground">또는</span>
          </div>
        </div>

        <button
          type="button"
          onClick={login}
          className="w-full py-2.5 text-sm text-muted-foreground border border-border
                     rounded-lg hover:bg-accent transition-colors"
        >
          브라우저에서 로그인
        </button>

        <button
          type="button"
          onClick={() => { sessionStorage.setItem('reselect_mode', '1'); window.location.reload() }}
          className="w-full mt-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          서버 주소 변경
        </button>

        {/* 완전 오프라인 탈출구: 로그인 없이 온디바이스 회의로(Android만). */}
        {IS_TAURI && IS_MOBILE && (
          <a
            href="/local-meetings"
            className="block w-full mt-2 py-2 text-center text-sm font-medium text-primary underline"
          >
            서버 없이 오프라인으로 시작 →
          </a>
        )}
      </div>
    </div>
  )
}
