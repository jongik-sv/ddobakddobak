import { useState, useEffect } from 'react'
import { X, Plus } from 'lucide-react'
import type { Meeting } from '../../api/meetings'
import type { Tag } from '../../api/tags'
import { getTags, createTag } from '../../api/tags'
import { getTeams } from '../../api/teams'

interface EditMeetingDialogProps {
  meeting: Meeting
  meetingTypeList: { value: string; label: string }[]
  onConfirm: (data: { title: string; meeting_type: string; tag_ids: number[] }) => void
  onClose: () => void
}

export default function EditMeetingDialog({
  meeting,
  meetingTypeList,
  onConfirm,
  onClose,
}: EditMeetingDialogProps) {
  const [title, setTitle] = useState(meeting.title)
  const [meetingType, setMeetingType] = useState(meeting.meeting_type)
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>(meeting.tags.map((t) => t.id))
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [newTagName, setNewTagName] = useState('')
  const [showNewTag, setShowNewTag] = useState(false)
  const [teamId, setTeamId] = useState<number | null>(null)

  useEffect(() => {
    getTags().then(setAllTags).catch(() => {})
    getTeams()
      .then((teams) => { if (teams.length > 0) setTeamId(teams[0].id) })
      .catch(() => {})
  }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    onConfirm({ title: title.trim(), meeting_type: meetingType, tag_ids: selectedTagIds })
  }

  const toggleTag = (tagId: number) => {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId],
    )
  }

  const handleCreateTag = async () => {
    if (!newTagName.trim() || !teamId) return
    const colors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316']
    const color = colors[allTags.length % colors.length]
    const tag = await createTag({ name: newTagName.trim(), color, team_id: teamId })
    setAllTags((prev) => [...prev, tag])
    setSelectedTagIds((prev) => [...prev, tag.id])
    setNewTagName('')
    setShowNewTag(false)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/10 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl border border-gray-100">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">회의 정보 수정</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 제목 */}
          <div>
            <label className="block text-sm font-medium mb-1">제목</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              autoFocus
            />
          </div>

          {/* 회의 유형 */}
          <div>
            <label className="block text-sm font-medium mb-2">회의 유형</label>
            <div className="flex flex-wrap gap-2">
              {meetingTypeList.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setMeetingType(t.value)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                    meetingType === t.value
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* 태그 */}
          <div>
            <label className="block text-sm font-medium mb-2">태그</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {allTags.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggleTag(tag.id)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                    selectedTagIds.includes(tag.id)
                      ? 'text-white border-transparent'
                      : 'bg-white border-gray-300 hover:border-gray-400'
                  }`}
                  style={
                    selectedTagIds.includes(tag.id)
                      ? { backgroundColor: tag.color, borderColor: tag.color }
                      : { color: tag.color }
                  }
                >
                  {tag.name}
                </button>
              ))}
              {!showNewTag && (
                <button
                  type="button"
                  onClick={() => setShowNewTag(true)}
                  className="px-2 py-1 rounded-full text-xs text-muted-foreground border border-dashed border-gray-300 hover:border-gray-400 transition-colors flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" /> 새 태그
                </button>
              )}
            </div>
            {showNewTag && (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleCreateTag() } }}
                  placeholder="태그 이름"
                  maxLength={30}
                  className="flex-1 rounded-md border px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={handleCreateTag}
                  disabled={!newTagName.trim()}
                  className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                >
                  추가
                </button>
                <button
                  type="button"
                  onClick={() => { setShowNewTag(false); setNewTagName('') }}
                  className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                >
                  취소
                </button>
              </div>
            )}
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
              disabled={!title.trim()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              저장
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
