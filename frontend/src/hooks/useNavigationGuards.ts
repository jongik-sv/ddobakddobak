import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { IS_TAURI } from '../config'

/**
 * 라이브 녹음 중 네비게이션 정책.
 *
 * B(백그라운드 녹음): 이탈 차단 제거 — 녹음 중에도 자유롭게 페이지를 떠날 수 있고
 * 녹음은 앱 레벨 세션에서 계속된다. 웹(브라우저)에서만 beforeunload 경고를 유지한다
 * (탭/창을 닫으면 JS가 죽어 녹음이 끊기므로). 데스크톱(Tauri)은 닫기=창 숨김이라 손실 없음.
 */
export function useNavigationGuards(meetingId: number, isActive: boolean) {
  const navigate = useNavigate()

  const handleNavigateBack = () => navigate(`/meetings/${meetingId}`)

  // 웹 한정: 녹음 중 탭/창 닫기·새로고침 경고(브라우저 기본 다이얼로그)
  useEffect(() => {
    if (IS_TAURI || !isActive) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isActive])

  return { handleNavigateBack }
}
