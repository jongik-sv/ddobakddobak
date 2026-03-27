import { useState } from 'react'
import { IS_TAURI } from '../config'
import SetupPage from '../pages/SetupPage'

/**
 * Tauri 프로덕션 환경에서만 SetupPage를 표시하는 게이트 컴포넌트.
 * 웹 모드 및 tauri dev 모드에서는 children을 즉시 렌더링한다.
 */
export default function SetupGate({ children }: { children: React.ReactNode }) {
  // tauri dev: 개발자가 서비스를 직접 관리하므로 건너뜀
  const needsSetup = IS_TAURI && !import.meta.env.DEV
  const [ready, setReady] = useState(!needsSetup)

  if (!ready) {
    return <SetupPage onReady={() => setReady(true)} />
  }

  return <>{children}</>
}
