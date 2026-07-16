import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IS_TAURI } from '../config'

/**
 * 라이브 녹음 중 네비게이션 정책.
 *
 * B(백그라운드 녹음): 페이지 이탈 자체는 허용(녹음은 앱 레벨 세션에서 계속)하되,
 * "실수로" 나가는 것은 막는다.
 *  - 웹(브라우저): 탭/창 닫기·새로고침은 beforeunload 경고(브라우저 기본 다이얼로그).
 *    데스크톱(Tauri)은 닫기=창 숨김이라 손실 없음 → 제외.
 *  - 브라우저 뒤로가기(popstate)는 beforeunload가 잡지 못하므로, 녹음 중엔
 *    센티넬 히스토리 항목으로 흡수하고 확인 다이얼로그(showLeaveConfirm)로만 이탈시킨다.
 *    (모바일 하드웨어 back 포함 — 플랫폼 무관하게 보호)
 */
export function useNavigationGuards(meetingId: number, isActive: boolean) {
  const navigate = useNavigate()
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)

  const handleNavigateBack = useCallback(
    () => navigate(`/meetings/${meetingId}`),
    [navigate, meetingId],
  )

  // 웹 한정: 녹음 중 탭/창 닫기·새로고침 경고(브라우저 기본 다이얼로그)
  useEffect(() => {
    if (IS_TAURI || !isActive) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isActive])

  // 브라우저 뒤로가기 가드: 녹음/STT 중엔 뒤로가기를 흡수하고 확인 후에만 이탈.
  const bypassRef = useRef(false)
  useEffect(() => {
    if (!isActive) return
    bypassRef.current = false
    // 현재 항목 위에 같은 URL의 센티넬을 쌓아 첫 뒤로가기를 흡수한다.
    window.history.pushState(null, '', window.location.href)
    const onPopState = () => {
      if (bypassRef.current) return // 확인 후 실제 이탈은 통과시킨다
      // 센티넬이 소비됐으므로 즉시 다시 고정하고 확인 다이얼로그를 띄운다.
      window.history.pushState(null, '', window.location.href)
      setShowLeaveConfirm(true)
    }
    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('popstate', onPopState)
      setShowLeaveConfirm(false)
    }
  }, [isActive])

  // 다이얼로그에서 "나가기" → 미리보기로 이탈(녹음은 백그라운드 세션에서 계속).
  const confirmLeave = useCallback(() => {
    bypassRef.current = true
    setShowLeaveConfirm(false)
    navigate(`/meetings/${meetingId}`)
  }, [navigate, meetingId])

  // "취소" → 그대로 머문다(센티넬은 이미 재고정됨).
  const cancelLeave = useCallback(() => setShowLeaveConfirm(false), [])

  return { handleNavigateBack, showLeaveConfirm, confirmLeave, cancelLeave }
}
