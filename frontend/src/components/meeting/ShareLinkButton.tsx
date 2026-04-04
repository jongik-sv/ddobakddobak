import { useState, useEffect, useRef } from 'react'

interface ShareLinkButtonProps {
  meetingId: number
}

export function ShareLinkButton({ meetingId }: ShareLinkButtonProps) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const handleCopy = async () => {
    const url = `${window.location.origin}/meetings/${meetingId}`
    await navigator.clipboard.writeText(url)
    setCopied(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 px-3 py-2 min-h-[44px] text-sm text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
    >
      {copied ? (
        <>
          <span>✓</span>
          <span>복사됨</span>
        </>
      ) : (
        <>
          <span>🔗</span>
          <span>링크 복사</span>
        </>
      )}
    </button>
  )
}
