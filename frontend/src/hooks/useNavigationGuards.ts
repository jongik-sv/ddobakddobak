import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

/**
 * 라이브 녹음 중 페이지 이탈 차단.
 *
 * useLiveRecording god 훅에서 분리 — 순수 코드 이동, 동작 무변경.
 * 녹음 활성(isActive) 동안 브라우저 뒤로가기/새로고침/단축키/popstate를 가로채
 * 이탈 경고(showLeaveBlock)를 띄운다. 비활성 시 뒤로가기는 미리보기로 이동한다.
 */
export function useNavigationGuards(meetingId: number, isActive: boolean) {
  const navigate = useNavigate()
  const [showLeaveBlock, setShowLeaveBlock] = useState(false)

  // 뒤로가기 (미리보기로) — 녹음 중이면 경고
  const handleNavigateBack = () => {
    if (isActive) {
      setShowLeaveBlock(true)
      return
    }
    navigate(`/meetings/${meetingId}`)
  }

  // 녹음 중 브라우저 뒤로가기/새로고침 차단
  useEffect(() => {
    if (!isActive) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isActive])

  // 녹음 중 Option+←/→ (히스토리 뒤로/앞으로) 키보드 단축키 차단
  useEffect(() => {
    if (!isActive) return
    const handler = (e: KeyboardEvent) => {
      // Option+← 또는 Option+→ (macOS 브라우저 뒤로/앞으로)
      if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault()
        setShowLeaveBlock(true)
      }
      // Cmd+[ 또는 Cmd+] (macOS 뒤로/앞으로)
      if (e.metaKey && (e.key === '[' || e.key === ']')) {
        e.preventDefault()
        setShowLeaveBlock(true)
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [isActive])

  // 녹음 중 popstate (브라우저 뒤로/앞으로 버튼) 차단
  useEffect(() => {
    if (!isActive) return
    const handler = () => {
      // 뒤로가기가 발생하면 원래 위치로 되돌리고 경고 표시
      window.history.pushState(null, '', window.location.href)
      setShowLeaveBlock(true)
    }
    // 현재 위치를 히스토리에 한 번 더 push (popstate 감지용)
    window.history.pushState(null, '', window.location.href)
    window.addEventListener('popstate', handler)
    return () => window.removeEventListener('popstate', handler)
  }, [isActive])

  return { showLeaveBlock, setShowLeaveBlock, handleNavigateBack }
}
