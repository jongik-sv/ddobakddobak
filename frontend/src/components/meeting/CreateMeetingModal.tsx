import { useState, useEffect } from 'react'
import { createMeeting } from '../../api/meetings'
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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const templates = useMeetingTemplateStore((s) => s.templates)
  const fetchTemplates = useMeetingTemplateStore((s) => s.fetch)

  useEffect(() => { fetchTemplates() }, [fetchTemplates])

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
