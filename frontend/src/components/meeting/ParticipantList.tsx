import { Crown, Eye } from 'lucide-react'
import { useSharingStore } from '../../stores/sharingStore'
import type { Participant } from '../../api/meetings'

interface ParticipantListProps {
  isHost: boolean
  currentUserId: number
  onTransferRequest?: (participant: Participant) => void
}

export function ParticipantList({
  isHost,
  currentUserId,
  onTransferRequest,
}: ParticipantListProps) {
  const participants = useSharingStore((s) => s.participants)

  return (
    <div className="px-3 py-2">
      <h3 className="text-xs font-semibold text-gray-500 mb-1">
        참여자 ({participants.length})
      </h3>
      <ul>
        {participants.map((p) => (
          <li key={p.user_id} className="flex items-center gap-2 py-1 text-sm">
            {p.role === 'host' ? (
              <Crown className="text-amber-500 w-4 h-4 shrink-0" />
            ) : (
              <Eye className="text-gray-400 w-4 h-4 shrink-0" />
            )}
            <span className="flex-1 truncate">
              {p.user_name}
              {p.user_id === currentUserId && (
                <span className="text-gray-400 ml-1">(나)</span>
              )}
            </span>
            {p.role === 'host' && (
              <span className="text-xs text-amber-600 font-medium">호스트</span>
            )}
            {isHost && p.role === 'viewer' && (
              <button
                onClick={() => onTransferRequest?.(p)}
                className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
              >
                넘기기
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
