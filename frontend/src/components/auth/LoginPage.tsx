import { LogIn } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'

export function LoginPage() {
  const { login } = useAuth()

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-slate-800 mb-2">또박또박</h1>
          <p className="text-slate-500">AI 회의록 - 로그인이 필요합니다</p>
        </div>

        <button
          type="button"
          onClick={login}
          className="w-full flex items-center justify-center gap-2 py-3
                     rounded-xl bg-blue-600 text-white font-semibold
                     hover:bg-blue-700 transition-colors cursor-pointer"
        >
          <LogIn className="w-5 h-5" />
          브라우저에서 로그인
        </button>

        <p className="text-sm text-slate-400 text-center mt-4">
          기본 브라우저에서 로그인 페이지가 열립니다.
          <br />
          로그인 완료 후 자동으로 돌아옵니다.
        </p>
      </div>
    </div>
  )
}
