import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 컴포넌트 로컬 토스트 상태. 전역 useToastStore(회의 라이브 상태바 전용 렌더러만 있어
 * 다른 라우트에서는 보이지 않는다)와 달리, 호출부가 직접 <LocalToast message={...}/>를
 * 마운트해 어디서든 실제로 화면에 보이는 안내를 띄울 수 있다.
 */
export function useLocalToast(durationMs = 3000) {
  const [message, setMessage] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = useCallback((text: string) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setMessage(text)
    timerRef.current = setTimeout(() => {
      setMessage(null)
      timerRef.current = null
    }, durationMs)
  }, [durationMs])

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  return { message, show }
}
