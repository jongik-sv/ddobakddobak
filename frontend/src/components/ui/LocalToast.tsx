interface LocalToastProps {
  /** null/빈 문자열이면 렌더하지 않는다. useLocalToast의 message를 그대로 전달. */
  message: string | null
}

/**
 * 고정 위치 소형 토스트 — useLocalToast와 짝을 이루는 프레젠테이션 컴포넌트.
 * AudioAppendFlowDialog의 배너(fixed bottom-right, bg-card/shadow-2xl) 스타일 관례를 따른다.
 * 표시/소멸 타이밍은 useLocalToast가 관리하므로 이 컴포넌트는 순수 표시만 담당한다.
 */
export function LocalToast({ message }: LocalToastProps) {
  if (!message) return null

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="local-toast"
      className="fixed bottom-4 right-4 z-[80] rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium text-foreground shadow-2xl"
    >
      {message}
    </div>
  )
}
