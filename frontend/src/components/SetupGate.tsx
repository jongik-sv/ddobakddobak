import { useState } from 'react'
import { IS_TAURI, getMode, hasMode } from '../config'
import SetupPage from '../pages/SetupPage'
import { ServerSetup } from './auth/ServerSetup'

type Gate = 'mode_select' | 'local_setup' | 'ready'

/**
 * Tauri 프로덕션 환경에서 모드 선택 → 로컬 환경 체크 게이트 컴포넌트.
 * 웹 모드 및 tauri dev 모드에서는 children을 즉시 렌더링한다.
 */
export default function SetupGate({ children }: { children: React.ReactNode }) {
  const skipGate = !IS_TAURI || import.meta.env.DEV

  const initialGate = (): Gate => {
    if (skipGate) return 'ready'
    if (!hasMode()) return 'mode_select'          // 첫 실행: 모드 선택
    if (getMode() === 'server') return 'ready'     // 서버 모드: AuthGuard가 처리
    return 'local_setup'                            // 로컬 모드: 환경 체크
  }

  const [gate, setGate] = useState<Gate>(initialGate)

  if (gate === 'mode_select') {
    return (
      <ServerSetup
        onComplete={() => {
          // ServerSetup이 localStorage에 mode/server_url을 이미 저장한 상태
          if (getMode() === 'server') {
            setGate('ready')
          } else {
            setGate('local_setup')
          }
        }}
      />
    )
  }

  if (gate === 'local_setup') {
    return <SetupPage onReady={() => setGate('ready')} />
  }

  return <>{children}</>
}
