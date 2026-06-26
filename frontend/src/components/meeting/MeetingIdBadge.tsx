import { useEffect, useRef, useState } from 'react'

interface MeetingIdBadgeProps {
  meetingId: number
}

/**
 * 회의 ID 배지 (#149). 클릭 시 클립보드 복사.
 * 데스크톱/모바일 앱은 주소창이 없어 URL의 회의 ID를 볼 수 없다 — 버그 리포트·지원 시 확인 수단.
 */
export function MeetingIdBadge({ meetingId }: MeetingIdBadgeProps) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(String(meetingId))
      setCopied(true)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard 미지원 환경(비보안 컨텍스트 등) — 표시 전용으로 동작
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="shrink-0 text-xs text-muted-foreground hover:text-foreground tabular-nums"
      title="회의 ID 복사"
    >
      {copied ? '복사됨' : `#${meetingId}`}
    </button>
  )
}
