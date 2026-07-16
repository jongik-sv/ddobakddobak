import { useState, useEffect } from 'react'
import { X, Plus } from 'lucide-react'
import { Dialog } from '../ui/Dialog'
import { getMeetings } from '../../api/meetings'
import type { Meeting, RecurrenceRule } from '../../api/meetings'
import type { Tag } from '../../api/tags'
import { getTags, createTag } from '../../api/tags'
import { ENGINE_LABELS } from '../../config'
import { ScheduleFields } from './ScheduleFields'
import { scheduleStateFromMeeting, scheduleToPayload, type ScheduleFormState } from '../../lib/schedulePayload'

export interface EditMeetingData {
  title: string
  meeting_type: string
  tag_ids: number[]
  brief_summary: string | null
  attendees: string | null
  expected_participants: number | null
  shared: boolean
  previous_meeting_id: number | null
  /** 예약 시작(예약 회의만). pending 일 때 포함되며 null=예약 해제. */
  scheduled_start_time?: string | null
  auto_start_mode?: 'auto' | 'manual' | null
  recurrence_rule?: RecurrenceRule | null
}

interface EditMeetingDialogProps {
  meeting: Meeting
  meetingTypeList: { value: string; label: string }[]
  onConfirm: (data: EditMeetingData) => void
  onClose: () => void
  /** 공유 토글 비활성화 (비소유자가 여는 경우). 기본 false. */
  disabled?: boolean
}

export default function EditMeetingDialog({
  meeting,
  meetingTypeList,
  onConfirm,
  onClose,
  disabled = false,
}: EditMeetingDialogProps) {
  const [title, setTitle] = useState(meeting.title)
  const [briefSummary, setBriefSummary] = useState(meeting.brief_summary ?? '')
  const [attendees, setAttendees] = useState(meeting.attendees ?? '')
  const [expectedParticipants, setExpectedParticipants] = useState(
    meeting.expected_participants != null ? String(meeting.expected_participants) : ''
  )
  const [meetingType, setMeetingType] = useState(meeting.meeting_type)
  const [shared, setShared] = useState(meeting.shared ?? true)
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>(meeting.tags?.map((t) => t.id) ?? [])
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [newTagName, setNewTagName] = useState('')
  const [showNewTag, setShowNewTag] = useState(false)
  const [previousMeetingId, setPreviousMeetingId] = useState(
    meeting.previous_meeting_id != null ? String(meeting.previous_meeting_id) : ''
  )
  const [folderMeetings, setFolderMeetings] = useState<Meeting[]>([])
  // 예약 수정은 아직 시작하지 않은 회의(pending)에서만 노출/전송한다.
  const isPending = meeting.status === 'pending'
  const [schedule, setSchedule] = useState<ScheduleFormState>(() => scheduleStateFromMeeting(meeting))

  useEffect(() => {
    getTags().then(setAllTags).catch(() => {})
  }, [])

  // 이전 회의 참고 셀렉터용: 같은 폴더의 회의 최근순 (자기 자신 제외).
  // show_all: 완료된 회의도 후보로 필요하다 — 기본 목록 큐레이션(important OR !completed)이
  // 걸리면 정상 종료된 회의가 통째로 사라져 이전 회의로 고를 수 없다(중요표시 무관하게 노출).
  useEffect(() => {
    getMeetings({ folder_id: meeting.folder_id, per: 100, show_all: true })
      .then((res) => setFolderMeetings(res.meetings.filter((m) => m.id !== meeting.id)))
      .catch(() => {})
  }, [meeting.folder_id, meeting.id])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    onConfirm({
      title: title.trim(),
      meeting_type: meetingType,
      tag_ids: selectedTagIds,
      brief_summary: briefSummary.trim() || null,
      attendees: attendees.trim() || null,
      expected_participants: expectedParticipants.trim() ? Number(expectedParticipants) : null,
      shared,
      previous_meeting_id: previousMeetingId ? Number(previousMeetingId) : null,
      // pending 회의만 예약(풀 트리플=null로 해제 가능)을 함께 보낸다. 비pending은 키 미포함.
      ...(isPending ? scheduleToPayload(schedule) : {}),
    })
  }

  const toggleTag = (tagId: number) => {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId],
    )
  }

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return
    const colors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316']
    const color = colors[allTags.length % colors.length]
    const tag = await createTag({ name: newTagName.trim(), color })
    setAllTags((prev) => [...prev, tag])
    setSelectedTagIds((prev) => [...prev, tag.id])
    setNewTagName('')
    setShowNewTag(false)
  }

  return (
    <Dialog onClose={onClose} backdropClassName="bg-black/10 backdrop-blur-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">회의 정보 수정</h2>
          <button onClick={onClose} className="p-2.5 rounded hover:bg-muted transition-colors">
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

          {/* 요약 */}
          <div>
            <label className="block text-sm font-medium mb-1">요약</label>
            <textarea
              value={briefSummary}
              onChange={(e) => setBriefSummary(e.target.value)}
              rows={3}
              placeholder="회의 요약을 입력하세요"
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </div>

          {/* 참석자 */}
          <div>
            <label className="block text-sm font-medium mb-1">참석자</label>
            <textarea
              value={attendees}
              onChange={(e) => setAttendees(e.target.value)}
              rows={2}
              placeholder="쉼표 또는 줄바꿈으로 구분 (예: 홍길동, 김영희)"
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </div>

          {/* 참여 인원 (화자분리 힌트) */}
          <div>
            <label className="block text-sm font-medium mb-1">참여 인원</label>
            <input
              type="number"
              min={1}
              max={100}
              value={expectedParticipants}
              onChange={(e) => setExpectedParticipants(e.target.value)}
              placeholder="비우면 자동 감지"
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              화자분리 시 이 인원수 ±2명 범위로 화자를 맞춥니다.
            </p>
          </div>

          {/* STT 모델 (읽기전용) — 배치 재전사에 사용된 엔진. 실시간 녹음만 한 회의는 없음 */}
          {meeting.stt_engine && (
            <div>
              <label className="block text-sm font-medium mb-1">STT 모델</label>
              <p className="text-sm text-muted-foreground">
                {ENGINE_LABELS[meeting.stt_engine] ?? meeting.stt_engine}
              </p>
            </div>
          )}

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
                      ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                      : 'bg-card text-muted-foreground border-border hover:border-muted-foreground'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* 이전 회의 참고 (같은 폴더 회의만) */}
          <div>
            <label className="block text-sm font-medium mb-1">이전 회의 참고</label>
            <select
              value={previousMeetingId}
              onChange={(e) => setPreviousMeetingId(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring bg-background"
            >
              <option value="">없음</option>
              {folderMeetings.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}{m.created_at ? ` (${new Date(m.created_at).toLocaleDateString()})` : ''}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              지정하면 이전 회의록을 이어받아 그 뒤에 이번 회의 내용을 작성합니다 (같은 폴더 회의만).
            </p>
          </div>

          {/* 예약 시작 (아직 시작하지 않은 회의만 수정 가능) */}
          {isPending && <ScheduleFields value={schedule} onChange={setSchedule} />}

          {/* 공유/비공개 */}
          <div>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={shared}
                disabled={disabled}
                onChange={(e) => setShared(e.target.checked)}
                className="h-4 w-4 rounded border-border accent-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="이 회의를 모든 사용자에게 공유"
              />
              <span className="text-sm font-medium">이 회의를 모든 사용자에게 공유</span>
            </label>
            <p className="mt-1 ml-6 text-xs text-muted-foreground">
              끄면 작성자와 관리자만 이 회의를 볼 수 있습니다.
            </p>
            {meeting.folder_shared === false && (
              <p className="mt-1 ml-6 text-xs text-amber-600">
                ⚠ 이 회의가 속한 폴더가 비공개라, 위 설정과 무관하게 작성자·관리자에게만 보입니다.
              </p>
            )}
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
                      : 'bg-card border-border hover:border-muted-foreground'
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
                  className="px-2 py-1 rounded-full text-xs text-muted-foreground border border-dashed border-border hover:border-muted-foreground transition-colors flex items-center gap-1"
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
    </Dialog>
  )
}
