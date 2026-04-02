import { Loader2 } from 'lucide-react'
import { getMode } from '../../config'
import { useAuth } from '../../hooks/useAuth'
import { LoginPage } from './LoginPage'

interface AuthGuardProps {
  children: React.ReactNode
}

/**
 * 서버 모드에서 인증되지 않은 사용자를 LoginPage로 차단한다.
 * 로컬 모드에서는 children을 그대로 렌더링한다 (가드 없음).
 */
export function AuthGuard({ children }: AuthGuardProps) {
  const { isAuthenticated, isLoading } = useAuth()

  // 로컬 모드: 인증 가드 없이 바로 통과
  if (getMode() !== 'server') {
    return <>{children}</>
  }

  // 서버 모드: 토큰 검증 중 로딩 표시
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          <p className="text-slate-500">인증 확인 중...</p>
        </div>
      </div>
    )
  }

  // 서버 모드 + 미인증: 로그인 페이지 표시
  if (!isAuthenticated) {
    return <LoginPage />
  }

  // 서버 모드 + 인증 완료: 메인 화면 접근 허용
  return <>{children}</>
}
