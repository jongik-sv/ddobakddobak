import { useState, useEffect } from 'react'
import { WifiOff, Crown } from 'lucide-react'
import { useSharingStore } from '../../stores/sharingStore'
import { claimHost } from '../../api/meetings'

interface Props {
  meetingId: number
}

export default function HostDisconnectedBanner({ meetingId }: Props) {
  const hostDisconnected = useSharingStore((s) => s.hostDisconnected)
  const hostClaimable = useSharingStore((s) => s.hostClaimable)
  const gracePeriodEndsAt = useSharingStore((s) => s.gracePeriodEndsAt)
  const [remaining, setRemaining] = useState(0)
  const [claiming, setClaiming] = useState(false)

  useEffect(() => {
    if (!gracePeriodEndsAt) return
    const tick = () => {
      const left = Math.max(0, Math.ceil((gracePeriodEndsAt - Date.now()) / 1000))
      setRemaining(left)
    }
    tick()
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  }, [gracePeriodEndsAt])

  if (!hostDisconnected) return null

  const handleClaim = async () => {
    setClaiming(true)
    try {
      const participants = await claimHost(meetingId)
      useSharingStore.getState().setParticipants(participants)
      useSharingStore.getState().clearHostDisconnected()
    } catch {
      // host_transferred 이벤트로 자동 처리될 수 있음
    } finally {
      setClaiming(false)
    }
  }

  return (
    <div className="mx-4 mt-2 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-3">
      <WifiOff className="w-5 h-5 text-amber-600 shrink-0" />
      <div className="flex-1 min-w-0">
        {hostClaimable ? (
          <p className="text-sm text-amber-800">호스트가 나갔습니다.</p>
        ) : (
          <p className="text-sm text-amber-800">
            호스트 연결이 끊어졌습니다. 재접속 대기 중... ({remaining}초)
          </p>
        )}
      </div>
      {hostClaimable && (
        <button
          onClick={handleClaim}
          disabled={claiming}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white text-sm font-medium rounded-lg
                     hover:bg-amber-700 transition-colors disabled:opacity-50 shrink-0"
        >
          <Crown className="w-4 h-4" />
          {claiming ? '처리 중...' : '호스트 되기'}
        </button>
      )}
    </div>
  )
}
