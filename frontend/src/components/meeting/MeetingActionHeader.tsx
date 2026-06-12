import { useState } from 'react'
import type { Meeting } from '../../api/meetings'
import { MeetingIdBadge } from './MeetingIdBadge'

// 모바일에서 상태 배지를 짧게 표시 (PC는 원문 그대로 유지)
const STATUS_SHORT_LABEL: Record<string, string> = {
  recording: '녹음',
  completed: '완료',
  pending: '대기',
}

interface MeetingActionHeaderProps {
  meeting: Meeting
  isDesktop: boolean
  meetingTypeLabel: string
  onUpdateTitle: (title: string) => Promise<void> | void
  /** 소유자/admin만 제목 인라인 편집 허용 (기본 true = 기존 동작). */
  canEdit?: boolean
}

/**
 * 회의 상세 제목 줄: 제목 인라인 편집 + 상태/유형/태그 배지.
 * 액션 버튼은 상단 툴바(MeetingDetailTopBar)로 분리됨(MeetingActions) → 이 줄은 제목 전용 폭을
 * 확보해 모바일에서 제목이 잘리지 않는다.
 */
export function MeetingActionHeader({
  meeting,
  isDesktop,
  meetingTypeLabel,
  onUpdateTitle,
  canEdit = true,
}: MeetingActionHeaderProps) {
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editingTitleValue, setEditingTitleValue] = useState('')

  function handleTitleClick() {
    setEditingTitleValue(meeting.title)
    setIsEditingTitle(true)
  }

  async function handleTitleSubmit() {
    if (editingTitleValue.trim()) {
      await onUpdateTitle(editingTitleValue.trim())
    }
    setIsEditingTitle(false)
  }

  function handleTitleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      handleTitleSubmit()
    } else if (e.key === 'Escape') {
      setIsEditingTitle(false)
    }
  }

  return (
    <div className={`flex items-center border-b bg-white shrink-0 ${isDesktop ? 'px-6 py-3' : 'px-3 py-2'}`}>
      <div className={`flex items-center flex-1 min-w-0 ${isDesktop ? 'gap-3' : 'gap-2'}`}>
        {isEditingTitle && canEdit ? (
          <input
            type="text"
            value={editingTitleValue}
            onChange={(e) => setEditingTitleValue(e.target.value)}
            onBlur={handleTitleSubmit}
            onKeyDown={handleTitleKeyDown}
            className="text-lg font-semibold text-gray-900 border-b-2 border-blue-500 outline-none bg-transparent flex-1 min-w-0"
            autoFocus
          />
        ) : canEdit ? (
          <h1
            className="text-lg font-semibold text-gray-900 truncate cursor-pointer hover:text-blue-700"
            onClick={handleTitleClick}
            title="클릭하여 제목 편집"
          >
            {meeting.title ?? '회의'}
          </h1>
        ) : (
          <h1 className="text-lg font-semibold text-gray-900 truncate">
            {meeting.title ?? '회의'}
          </h1>
        )}
        <MeetingIdBadge meetingId={meeting.id} />
        {meeting.status && (
          <span className={`shrink-0 rounded-full bg-gray-100 text-gray-600 ${isDesktop ? 'px-2 py-0.5 text-xs' : 'px-1.5 py-0 text-[10px]'}`}>
            {isDesktop ? meeting.status : (STATUS_SHORT_LABEL[meeting.status] ?? meeting.status)}
          </span>
        )}
        {meetingTypeLabel && (
          <span className={`shrink-0 rounded-full bg-blue-50 text-blue-600 border border-blue-200 ${isDesktop ? 'px-2 py-0.5 text-xs' : 'px-1.5 py-0 text-[10px]'}`}>
            {meetingTypeLabel}
          </span>
        )}
        {isDesktop && meeting.tags?.map((tag) => (
          <span
            key={tag.id}
            className="shrink-0 px-2 py-0.5 text-xs rounded-full text-white"
            style={{ backgroundColor: tag.color }}
          >
            {tag.name}
          </span>
        ))}
      </div>
    </div>
  )
}
