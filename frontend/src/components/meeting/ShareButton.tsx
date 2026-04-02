import { useState, useCallback, useRef, useEffect } from 'react'
import { Share2, Copy, Check, X } from 'lucide-react'
import { useSharingStore } from '../../stores/sharingStore'
import { shareMeeting, stopSharing } from '../../api/meetings'

interface ShareButtonProps {
  meetingId: number
}

export function ShareButton({ meetingId }: ShareButtonProps) {
  const shareCode = useSharingStore((s) => s.shareCode)
  const isLoading = useSharingStore((s) => s.isLoading)
  const isSharing = shareCode !== null

  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => () => clearTimeout(copyTimerRef.current), [])

  const handleShare = useCallback(async () => {
    useSharingStore.getState().setLoading(true)
    try {
      const res = await shareMeeting(meetingId)
      useSharingStore.getState().startSharing(res.share_code, res.participants)
    } catch (err) {
      console.error('[ShareButton] 공유 시작 실패:', err)
    } finally {
      useSharingStore.getState().setLoading(false)
    }
  }, [meetingId])

  const handleStop = useCallback(async () => {
    try {
      await stopSharing(meetingId)
      useSharingStore.getState().stopSharing()
    } catch (err) {
      console.error('[ShareButton] 공유 중지 실패:', err)
    }
  }, [meetingId])

  const handleCopy = useCallback(async () => {
    if (!shareCode) return
    try {
      await navigator.clipboard.writeText(shareCode)
      setCopied(true)
      clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('[ShareButton] 클립보드 복사 실패:', err)
    }
  }, [shareCode])

  if (!isSharing) {
    return (
      <button
        onClick={handleShare}
        disabled={isLoading}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors disabled:opacity-50"
      >
        <Share2 className="w-4 h-4" />
        공유
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-green-700 bg-green-50 border border-green-200 rounded-md">
      <Share2 className="w-4 h-4" />
      <span className="font-mono tracking-wider">{shareCode}</span>
      <button
        onClick={handleCopy}
        title={copied ? '복사됨' : '공유 코드 복사'}
        className="p-0.5 rounded hover:bg-green-100 transition-colors"
      >
        {copied ? (
          <Check className="w-3.5 h-3.5 text-green-600" />
        ) : (
          <Copy className="w-3.5 h-3.5 text-green-600" />
        )}
      </button>
      <button
        onClick={handleStop}
        title="공유 중지"
        className="p-0.5 rounded text-red-500 hover:text-red-700 hover:bg-red-50 transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
