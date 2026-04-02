import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { joinMeeting } from '../../api/meetings'

interface JoinMeetingDialogProps {
  open: boolean
  onClose: () => void
}

export function JoinMeetingDialog({ open, onClose }: JoinMeetingDialogProps) {
  const navigate = useNavigate()
  const [shareCode, setShareCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  if (!open) return null

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.toUpperCase().slice(0, 6)
    setShareCode(value)
    if (error) setError('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!shareCode.trim()) return
    setLoading(true)
    setError('')
    try {
      const { meeting } = await joinMeeting(shareCode)
      onClose()
      navigate(`/meetings/${meeting.id}/viewer`)
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('회의 참여에 실패했습니다.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/10 backdrop-blur-sm"
    >
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl border border-gray-100">
        <h2 className="text-lg font-semibold mb-4">회의 참여</h2>

        {error && (
          <div role="alert" className="rounded-md bg-destructive/10 px-4 py-2 text-sm text-destructive mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">공유 코드</label>
            <input
              type="text"
              value={shareCode}
              onChange={handleCodeChange}
              placeholder="공유 코드를 입력하세요 (6자리)"
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring font-mono text-center text-lg tracking-widest uppercase"
              autoFocus
              maxLength={6}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={loading || !shareCode.trim()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {loading ? '참여 중...' : '참여'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
