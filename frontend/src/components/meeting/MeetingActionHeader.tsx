import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Lock, Unlock } from 'lucide-react'
import type { Meeting } from '../../api/meetings'
import { MeetingIdBadge } from './MeetingIdBadge'
import { DflowSyncBadge } from './MeetingListUI'
import { Tooltip } from '../ui/Tooltip'

/** children으로 렌더 prop을 넘기면 title/badges/lockToggle 슬롯을 분리해 전달한다(모바일 2줄 조립용).
 *  넘기지 않으면 기존과 동일한 단일 Fragment(데스크톱 레이아웃)를 그대로 반환한다. */
export interface MeetingActionHeaderSlots {
  title: ReactNode
  badges: ReactNode
  lockToggle: ReactNode
}

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
  /** 제목 인라인 편집 시작/종료 시 호출 — 상위(MeetingDetailTopBar)가 편집 중 주변 아이콘을 접는 데 사용. */
  onEditingChange?: (editing: boolean) => void
  /** 지정하면 title/badges/lockToggle 슬롯을 분리해 렌더 prop으로 전달(모바일 2줄 조립용).
   *  미지정 시 기존 단일 Fragment 레이아웃(데스크톱) 그대로 반환. */
  children?: (slots: MeetingActionHeaderSlots) => ReactNode
}

/**
 * 회의 상세 제목 + 상태/유형/태그 배지 + 제목 인라인 편집.
 * 자체 행(border/배경/패딩)을 갖지 않는 콘텐츠 전용 컴포넌트 — 상단 툴바(MeetingDetailTopBar)의
 * flex-wrap 영역 안에 인라인으로 흡수되어 제목 줄이 별도 행으로 분리되지 않는다(옵션 B: 배지는
 * 전부 상시 노출하되 폭이 부족하면 이 영역 안에서만 자연스럽게 다음 줄로 wrap).
 */
export function MeetingActionHeader({
  meeting,
  isDesktop,
  meetingTypeLabel,
  onUpdateTitle,
  canEdit = true,
  onToggleLock,
  isTogglingLock = false,
  onEditingChange,
  children,
}: MeetingActionHeaderProps) {
  const navigate = useNavigate()
  const [isEditingTitle, setIsEditingTitleState] = useState(false)
  const [editingTitleValue, setEditingTitleValue] = useState('')
  // 잠긴 회의는 제목 인라인 편집도 막는다(잠금 토글 버튼은 canEdit로 계속 노출).
  const titleEditable = canEdit && !meeting.locked

  function setIsEditingTitle(editing: boolean) {
    setIsEditingTitleState(editing)
    onEditingChange?.(editing)
  }

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

  // 제목 노드 — 인라인 편집 input / 편집가능 h1 / 읽기전용 h1.
  const titleNode = isEditingTitle && titleEditable ? (
    <input
      type="text"
      value={editingTitleValue}
      onChange={(e) => setEditingTitleValue(e.target.value)}
      onBlur={handleTitleSubmit}
      onKeyDown={handleTitleKeyDown}
      className="text-lg font-semibold text-foreground border-b-2 border-blue-500 outline-none bg-transparent flex-1 min-w-[8ch]"
      autoFocus
    />
  ) : titleEditable ? (
    <h1
      className="min-w-[12ch] max-w-[60vw] lg:max-w-[40vw] text-lg font-semibold text-foreground truncate cursor-pointer hover:text-blue-700"
      onClick={handleTitleClick}
      title="클릭하여 제목 편집"
    >
      {meeting.title ?? '회의'}
    </h1>
  ) : (
    <h1 className="min-w-[12ch] max-w-[60vw] lg:max-w-[40vw] text-lg font-semibold text-foreground truncate">
      {meeting.title ?? '회의'}
    </h1>
  )

  // 배지 그룹 — ID/잠금/상태/요약중/유형/이전회의/D'Flow/태그.
  const badgesNode = (
    <>
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
        <span className="shrink-0">
          <Tooltip text={`이전 회의 이어받음: ${meeting.previous_meeting_title}`} position="bottom">
            {meeting.previous_meeting_id ? (
              <button
                type="button"
                onClick={() => navigate(`/meetings/${meeting.previous_meeting_id}`)}
                aria-label={`이전 회의로 이동: ${meeting.previous_meeting_title}`}
                className={`rounded-full bg-violet-50 text-violet-600 border border-violet-200 hover:bg-violet-100 cursor-pointer transition-colors ${isDesktop ? 'px-2 py-0.5 text-xs' : 'px-1.5 py-0 text-[10px]'}`}
              >
                ↩ 이전
              </button>
            ) : (
              <span
                className={`inline-block rounded-full bg-violet-50 text-violet-600 border border-violet-200 ${isDesktop ? 'px-2 py-0.5 text-xs' : 'px-1.5 py-0 text-[10px]'}`}
              >
                ↩ 이전
              </span>
            )}
          </Tooltip>
        </span>
      )}
      <DflowSyncBadge dflowSyncedAt={meeting.dflow_synced_at} dflowNeedsResync={meeting.dflow_needs_resync} isDesktop={isDesktop} />
      {isDesktop && meeting.tags?.map((tag) => (
        <span
          key={tag.id}
          className="shrink-0 px-2 py-0.5 text-xs rounded-full text-white"
          style={{ backgroundColor: tag.color }}
        >
          {tag.name}
        </span>
      ))}
    </>
  )

  // 잠금/해제 토글 (소유자·admin만; 잠금 중에도 동작).
  const lockToggleNode = onToggleLock && canEdit ? (
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
  ) : null

  if (children) {
    return <>{children({ title: titleNode, badges: badgesNode, lockToggle: lockToggleNode })}</>
  }

  return (
    <>
      <div className={`flex items-center flex-1 min-w-0 flex-wrap gap-y-1 ${isDesktop ? 'gap-x-3' : 'gap-x-2'}`}>
        {titleNode}
        {badgesNode}
      </div>
      {/* 잠금/해제 토글 — 제목 폭을 차지하지 않도록 그룹 밖 우측. */}
      {lockToggleNode}
    </>
  )
}
