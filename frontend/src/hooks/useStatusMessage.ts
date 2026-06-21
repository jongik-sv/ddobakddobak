import { useState, useCallback, useRef } from 'react'

export function useStatusMessage() {
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const statusTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const showStatus = useCallback((msg: string, durationMs = 3000) => {
    setStatusMessage(msg)
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
    statusTimerRef.current = setTimeout(() => setStatusMessage(null), durationMs)
  }, [])
  return { statusMessage, showStatus }
}
