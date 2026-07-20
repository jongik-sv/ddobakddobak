import { useState } from 'react'
import { Lock, Unlock } from 'lucide-react'
import type { Meeting } from '../../api/meetings'
import { MeetingIdBadge } from './MeetingIdBadge'
import { Tooltip } from '../ui/Tooltip'

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
  /** 잠금/해제 토글 핸들러. 소유자/admin만 노출(canEdit). 미지정이면 버튼 숨김. */
  onToggleLock?: () => void
  /** 잠금/해제 요청 진행 중이면 버튼 비활성. */
  isTogglingLock?: boolean
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
  onToggleLock,
  isTogglingLock = false,
}: MeetingActionHeaderProps) {
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editingTitleValue, setEditingTitleValue] = useState('')
  // 잠긴 회의는 제목 인라인 편집도 막는다(잠금 토글 버튼은 canEdit로 계속 노출).
  const titleEditable = canEdit && !meeting.locked

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

  // D'Flow 전송 상태 배지: 재전송 필요 > 전송됨 > (미전송이면 배지 없음).
  const dflowBadge = meeting.dflow_needs_resync
    ? { label: "D'Flow 재전송 필요", title: '회의록이 마지막 전송 이후 수정되었습니다', className: 'bg-amber-100 text-amber-700 border-amber-300' }
    : meeting.dflow_synced_at
      ? { label: "D'Flow ✓", title: 'D\'Flow로 전송된 회의입니다', className: 'bg-emerald-50 text-emerald-700 border-emerald-300' }
      : null

  return (
    <div className={`flex items-center border-b bg-card shrink-0 ${isDesktop ? 'px-6 py-3' : 'px-3 py-2'}`}>
      <div className={`flex items-center flex-1 min-w-0 ${isDesktop ? 'gap-3' : 'gap-2'}`}>
        {isEditingTitle && titleEditable ? (
          <input
            type="text"
            value={editingTitleValue}
            onChange={(e) => setEditingTitleValue(e.target.value)}
            onBlur={handleTitleSubmit}
            onKeyDown={handleTitleKeyDown}
            className="text-lg font-semibold text-foreground border-b-2 border-blue-500 outline-none bg-transparent flex-1 min-w-0"
            autoFocus
          />
        ) : titleEditable ? (
          <h1
            className="text-lg font-semibold text-foreground truncate cursor-pointer hover:text-blue-700"
            onClick={handleTitleClick}
            title="클릭하여 제목 편집"
          >
            {meeting.title ?? '회의'}
          </h1>
        ) : (
          <h1 className="text-lg font-semibold text-foreground truncate">
            {meeting.title ?? '회의'}
          </h1>
        )}
        <MeetingIdBadge meetingId={meeting.id} />
        {meeting.locked && (
          <span
            className={`shrink-0 inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-700 border border-amber-300 ${isDesktop ? 'px-2 py-0.5 text-xs' : 'px-1.5 py-0 text-[10px]'}`}
            title="잠긴 회의입니다 (읽기 전용)"
          >
            <Lock className={isDesktop ? 'w-3 h-3' : 'w-2.5 h-2.5'} />
            {isDesktop ? '읽기 전용' : '잠금'}
          </span>
        )}
        {meeting.status && (
          <span className={`shrink-0 rounded-full bg-muted text-muted-foreground ${isDesktop ? 'px-2 py-0.5 text-xs' : 'px-1.5 py-0 text-[10px]'}`}>
            {isDesktop ? meeting.status : (STATUS_SHORT_LABEL[meeting.status] ?? meeting.status)}
          </span>
        )}
        {meeting.summarizing && (
          <span
            className={`shrink-0 inline-flex items-center gap-1 rounded-full bg-blue-100 text-blue-700 ${isDesktop ? 'px-2 py-0.5 text-xs' : 'px-1.5 py-0 text-[10px]'}`}
            title="요약 생성 중 — 완료까지 수십 초 걸릴 수 있습니다"
          >
            <span className="inline-block w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
            {isDesktop ? '요약중' : '요약'}
          </span>
        )}
        {meetingTypeLabel && (
          <span className={`shrink-0 rounded-full bg-blue-50 text-blue-600 border border-blue-200 ${isDesktop ? 'px-2 py-0.5 text-xs' : 'px-1.5 py-0 text-[10px]'}`}>
            {meetingTypeLabel}
          </span>
        )}
        {meeting.previous_meeting_title && (
          <span
            className={`shrink-0 rounded-full bg-violet-50 text-violet-600 border border-violet-200 ${isDesktop ? 'px-2 py-0.5 text-xs' : 'px-1.5 py-0 text-[10px]'}`}
            title={`이전 회의 이어받음: ${meeting.previous_meeting_title}`}
          >
            {isDesktop ? `↩ 이전 회의: ${meeting.previous_meeting_title}` : '↩ 이전'}
          </span>
        )}
        {dflowBadge && (
          <span
            className={`shrink-0 rounded-full border ${dflowBadge.className} ${isDesktop ? 'px-2 py-0.5 text-xs' : 'px-1.5 py-0 text-[10px]'}`}
            title={dflowBadge.title}
          >
            {dflowBadge.label}
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
      {/* 잠금/해제 토글 (소유자·admin만; 잠금 중에도 동작) — 제목 폭을 차지하지 않도록 그룹 밖 우측. */}
      {onToggleLock && canEdit && (
        <Tooltip text={meeting.locked ? '회의 잠금 해제' : '회의 잠금 (읽기 전용)'}>
          <button
            type="button"
            onClick={onToggleLock}
            disabled={isTogglingLock}
            aria-label={meeting.locked ? '회의 잠금 해제' : '회의 잠금'}
            className={`shrink-0 ml-2 p-1.5 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              meeting.locked
                ? 'text-amber-600 bg-amber-50 hover:bg-amber-100'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            }`}
          >
            {meeting.locked ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
          </button>
        </Tooltip>
      )}
    </div>
  )
}
