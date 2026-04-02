import { useState, useCallback } from 'react'
import { transferHost } from '../../api/meetings'
import { useSharingStore } from '../../stores/sharingStore'

interface HostTransferDialogProps {
  open: boolean
  targetUserName: string
  targetUserId: number
  meetingId: number
  onClose: () => void
  onTransferred: () => void
}

export function HostTransferDialog({
  open,
  targetUserName,
  targetUserId,
  meetingId,
  onClose,
  onTransferred,
}: HostTransferDialogProps) {
  const [isTransferring, setIsTransferring] = useState(false)

  const handleTransfer = useCallback(async () => {
    setIsTransferring(true)
    try {
      const updatedParticipants = await transferHost(meetingId, targetUserId)
      useSharingStore.getState().setParticipants(updatedParticipants)
      onTransferred()
    } catch (err) {
      console.error('[HostTransferDialog] 호스트 위임 실패:', err)
    } finally {
      setIsTransferring(false)
    }
  }, [meetingId, targetUserId, onTransferred])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm mx-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">호스트 위임</h3>
        <p className="text-sm text-gray-600 mb-1">
          정말 {targetUserName}에게 호스트를 넘기시겠습니까?
        </p>
        <p className="text-sm text-gray-600 mb-5">
          호스트를 넘기면 녹음 컨트롤 권한이 이동합니다.
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={isTransferring}
            className="px-4 py-2 rounded-md text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleTransfer}
            disabled={isTransferring}
            className="px-4 py-2 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {isTransferring ? '위임 중...' : '위임하기'}
          </button>
        </div>
      </div>
    </div>
  )
}
