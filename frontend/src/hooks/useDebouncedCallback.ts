import { useCallback, useEffect, useRef } from 'react'

/**
 * 공용 디바운스 훅. `run(...)`을 호출할 때마다 이전 예약을 취소하고 delayMs 후
 * 다시 예약한다 — hooks/useBlockSync.ts(구 145,297-317)와
 * components/meeting/AiSummaryPanel.tsx(구 64,98,212-224)의 "타이머 ref +
 * clearTimeout 후 재설정" 패턴을 그대로 일반화한 것이다.
 *
 * fn은 "예약 시점"의 클로저를 그대로 실행한다(최신 fn을 fire하지 않음) —
 * 두 호출부 모두 콜백이 스케줄 당시의 값(meetingId 등)을 캡처해야 하므로
 * (예: useBlockSync의 flushChanges는 deps=[meetingId]), ref로 최신 fn을
 * 가리켜 실행하면 회의 전환 중 디바운스가 걸린 상태에서 다른 회의로 flush되는
 * 회귀가 생긴다.
 *
 * cancel은 항상 동일한 참조([]로 고정)를 반환한다 — AiSummaryPanel처럼
 * effect 밖에서(메모 초기화 등) 보류 타이머를 즉시 취소해야 하는 호출부가
 * deps에 넣어도 그 effect의 재실행 시점이 바뀌지 않게 하기 위함이다.
 */
export function useDebouncedCallback<Args extends unknown[]>(
  fn: (...args: Args) => void,
  delayMs: number
): { run: (...args: Args) => void; cancel: () => void } {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const run = useCallback(
    (...args: Args) => {
      cancel()
      const f = fn
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        f(...args)
      }, delayMs)
    },
    [cancel, fn, delayMs]
  )

  // 언마운트 시 보류 타이머 정리.
  useEffect(() => cancel, [cancel])

  return { run, cancel }
}
