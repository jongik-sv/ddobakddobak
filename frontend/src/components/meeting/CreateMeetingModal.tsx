import { useState, useEffect } from 'react'
import { createMeeting, getMeetings } from '../../api/meetings'
import type { Meeting } from '../../api/meetings'
import { useMeetingTemplateStore } from '../../stores/meetingTemplateStore'
import { Dialog } from '../ui/Dialog'
import { MeetingTypeSelector } from './MeetingListUI'

interface CreateMeetingModalProps {
  folderId: number | null
  meetingTypeList: { value: string; label: string }[]
  onClose: () => void
  onCreated: (meeting: Meeting) => void
}

export function CreateMeetingModal({ folderId, meetingTypeList, onClose, onCreated }: CreateMeetingModalProps) {
  const [title, setTitle] = useState('')
  const [meetingType, setMeetingType] = useState('general')
  const [shared, setShared] = useState(true)
  const [previousMeetingId, setPreviousMeetingId] = useState('')
  const [recentMeetings, setRecentMeetings] = useState<Meeting[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const templates = useMeetingTemplateStore((s) => s.templates)
  const fetchTemplates = useMeetingTemplateStore((s) => s.fetch)

  useEffect(() => { fetchTemplates() }, [fetchTemplates])

  // 이전 회의 참고 셀렉터용: 같은 폴더의 회의 최근순 목록 (folderId=null이면 루트)
  useEffect(() => {
    getMeetings({ folder_id: folderId, per: 100 })
      .then((res) => setRecentMeetings(res.meetings))
      .catch(() => {})
  }, [folderId])

  const handleTemplateSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const templateId = Number(e.target.value)
    if (!templateId) return
    const tpl = templates.find((t) => t.id === templateId)
    if (!tpl) return
    if (tpl.meeting_type) setMeetingType(tpl.meeting_type)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    setLoading(true)
    setError('')
    try {
      const meeting = await createMeeting({
        title: title.trim(),
        meeting_type: meetingType,
        folder_id: folderId,
        shared,
        previous_meeting_id: previousMeetingId ? Number(previousMeetingId) : null,
      })
      onCreated(meeting)
      onClose()
    } catch {
      setError('회의 생성에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog onClose={onClose} backdropClassName="bg-black/10 backdrop-blur-sm" closeOnBackdrop={false} closeOnEsc={false}>
      <h2 className="text-lg font-semibold mb-4">새 회의 만들기</h2>

      {error && (
        <div role="alert" className="rounded-md bg-destructive/10 px-4 py-2 text-sm text-destructive mb-4">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* 템플릿 선택 */}
        {templates.length > 0 && (
          <div>
            <label className="block text-sm font-medium mb-1">템플릿</label>
            <select
              onChange={handleTemplateSelect}
              defaultValue=""
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring bg-white"
            >
              <option value="">템플릿 없이 시작</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-1">회의 제목</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="회의 제목을 입력하세요"
            className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            autoFocus
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">회의 유형</label>
          <MeetingTypeSelector
            meetingTypeList={meetingTypeList}
            selected={meetingType}
            onSelect={setMeetingType}
          />
        </div>

        {/* 이전 회의 참고: 선택하면 그 회의록을 시작점으로 깔고 이어서 회의록을 작성 */}
        <div>
          <label className="block text-sm font-medium mb-1">이전 회의 참고 (선택)</label>
          <select
            value={previousMeetingId}
            onChange={(e) => setPreviousMeetingId(e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring bg-white"
          >
            <option value="">없음</option>
            {recentMeetings.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}{m.created_at ? ` (${new Date(m.created_at).toLocaleDateString()})` : ''}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">
            지정하면 이전 회의록을 이어받아 그 뒤에 이번 회의 내용을 작성합니다.
          </p>
        </div>

        <div>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={shared}
              onChange={(e) => setShared(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 accent-blue-600"
              aria-label="이 회의를 모든 사용자에게 공유"
            />
            <span className="text-sm font-medium">이 회의를 모든 사용자에게 공유</span>
          </label>
          <p className="mt-1 ml-6 text-xs text-muted-foreground">
            끄면 작성자와 관리자만 이 회의를 볼 수 있습니다.
          </p>
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
            disabled={loading || !title.trim()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            생성
          </button>
        </div>
      </form>
    </Dialog>
  )
}
