import { useState } from 'react'
import { IS_TAURI, getMode, hasMode, getServerUrl } from '../config'
import SetupPage from '../pages/SetupPage'
import { ServerSetup } from './auth/ServerSetup'

type Gate = 'mode_select' | 'local_setup' | 'ready'

/**
 * Tauri 프로덕션 환경에서 모드 선택 → 로컬 환경 체크 게이트 컴포넌트.
 * 웹 모드 및 tauri dev 모드에서는 children을 즉시 렌더링한다.
 */
export default function SetupGate({ children }: { children: React.ReactNode }) {
  const initialGate = (): Gate => {
    if (!IS_TAURI) return 'ready'                   // 웹 모드: 게이트 건너뜀
    if (sessionStorage.getItem('reselect_mode')) return 'mode_select' // 모드 재선택
    if (!hasMode()) return 'mode_select'            // 첫 실행: 모드 선택
    if (getMode() === 'server') {
      // 서버 모드인데 server_url이 비어있으면 설정 화면으로 강제 유도
      // (예전엔 조용히 localhost로 폴백해서 디버깅이 어려웠음)
      if (!getServerUrl()) return 'mode_select'
      return 'ready'                                 // 서버 모드: AuthGuard가 처리
    }
    if (import.meta.env.DEV) return 'ready'         // 로컬 + dev: 환경 체크 건너뜀
    return 'local_setup'                             // 로컬 + 프로덕션: 환경 체크
  }

  const [gate, setGate] = useState<Gate>(initialGate)

  if (gate === 'mode_select') {
    return (
      <ServerSetup
        onComplete={() => {
          sessionStorage.removeItem('reselect_mode')
          if (getMode() === 'server') {
            setGate('ready')
          } else {
            setGate('local_setup')
          }
        }}
        onCancel={() => { sessionStorage.removeItem('reselect_mode'); setGate('ready') }}
      />
    )
  }

  if (gate === 'local_setup') {
    return <SetupPage onReady={() => setGate('ready')} />
  }

  return <>{children}</>
}
