import { useState, useEffect, useRef } from 'react'
import { FolderInput, MoreVertical, PackageOpen, Pencil, Trash2 } from 'lucide-react'
import type { Meeting } from '../../api/meetings'
import { canEditMeeting } from '../../api/meetings'
import { useAuthStore } from '../../stores/authStore'

export const STATUS_FILTER_TABS = [
  { value: '', label: '전체' },
  { value: 'recording', label: '녹음중' },
  { value: 'completed', label: '완료' },
  { value: 'pending', label: '대기중' },
] as const

export function StatusBadge({
  status,
  scheduled,
  paused,
  summarizing,
}: {
  status: Meeting['status']
  scheduled?: boolean
  paused?: boolean
  /** 서버 영속 "요약 진행 중" — regenerate/summarize/final/realtime 실행 중.
   *  새로고침·페이지 이탈 후에도 유지되는 보조 상태 배지(파란색 pulse). */
  summarizing?: boolean
}) {
  // 기존 status 분기 로직은 그대로 두고, summarizing=true 일 때만 "요약중" 보조 배지를
  // 추가로 덧붙인다 — completed(재생성 중)가 가장 흔한 케이스라 status 와 겹쳐 표시.
  const statusBadge = renderStatusBadge(status, scheduled, paused)
  if (!summarizing) return statusBadge
  return (
    <>
      {statusBadge}
      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 flex items-center gap-1 whitespace-nowrap shrink-0">
        <span className="inline-block w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
        요약중
      </span>
    </>
  )
}

function renderStatusBadge(status: Meeting['status'], scheduled?: boolean, paused?: boolean) {
  if (status === 'pending') {
    if (scheduled === true) {
      return (
        <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 flex items-center gap-1 whitespace-nowrap shrink-0">
          <span aria-hidden>⏰</span>
          예약중
        </span>
      )
    }
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground whitespace-nowrap shrink-0">
        대기중
      </span>
    )
  }
  if (status === 'recording') {
    if (paused === true) {
      return (
        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 flex items-center gap-1 whitespace-nowrap shrink-0">
          <span className="inline-block w-1.5 h-1.5 bg-amber-500 rounded-full" />
          일시정지
        </span>
      )
    }
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 flex items-center gap-1 whitespace-nowrap shrink-0">
        <span className="inline-block w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
        녹음중
      </span>
    )
  }
  if (status === 'transcribing') {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 flex items-center gap-1 whitespace-nowrap shrink-0">
        <span className="inline-block w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" />
        변환중
      </span>
    )
  }
  return (
    <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 whitespace-nowrap shrink-0">
      완료
    </span>
  )
}

interface DflowSyncBadgeProps {
  dflowSyncedAt?: string | null
  dflowNeedsResync?: boolean
  /** 목록(카드/테이블)처럼 항상 작은 고정 크기(px-1.5 py-0 text-[10px])로 렌더. */
  compact?: boolean
  /** compact=false일 때만 사용 — MeetingActionHeader의 기존 데스크톱/모바일 크기 분기를 그대로 재현. */
  isDesktop?: boolean
}

/**
 * D'Flow 전송 상태 배지. 우선순위: 재전송 필요 > 전송됨 > (미전송이면 렌더 안 함).
 * MeetingActionHeader에 있던 삼항 로직을 공용화 — 소비처(헤더/카드/테이블)가 각자
 * 우선순위 판단을 복붙하지 않도록 여기 한 곳에서만 결정한다.
 */
export function DflowSyncBadge({ dflowSyncedAt, dflowNeedsResync, compact = false, isDesktop = true }: DflowSyncBadgeProps) {
  const badge = dflowNeedsResync
    ? { label: "D'Flow 재전송 필요", title: '회의록이 마지막 전송 이후 수정되었습니다', className: 'bg-amber-100 text-amber-700 border-amber-300' }
    : dflowSyncedAt
      ? { label: "D'Flow ✓", title: "D'Flow로 전송된 회의입니다", className: 'bg-emerald-50 text-emerald-700 border-emerald-300' }
      : null

  if (!badge) return null

  const sizeClass = compact ? 'px-1.5 py-0 text-[10px]' : isDesktop ? 'px-2 py-0.5 text-xs' : 'px-1.5 py-0 text-[10px]'

  return (
    <span
      className={`shrink-0 rounded-full border ${badge.className} ${sizeClass}`}
      title={badge.title}
    >
      {badge.label}
    </span>
  )
}

interface RedactedBadgeProps {
  redacted?: boolean
  /** 목록(카드/테이블)처럼 항상 작은 고정 크기(px-1.5 py-0 text-[10px])로 렌더. DflowSyncBadge와
   *  동일 패턴 — 소비처가 각자 크기 분기를 복붙하지 않도록 한다. */
  compact?: boolean
}

/**
 * 기밀 구간 절단(transcripts#redact) 적용 배지. meeting.transcripts_redacted 는 목록(full:false)
 * 응답에도 노출되므로(meeting_serializable.rb) 카드/테이블 어디서나 재조회 없이 그릴 수 있다.
 * 이 회의는 추가 녹음·전사 동기화를 받지 않는다 — 사용자가 왜 녹음 버튼이 없는지 알 수 있어야 한다.
 */
export function RedactedBadge({ redacted, compact = false }: RedactedBadgeProps) {
  if (!redacted) return null

  const sizeClass = compact ? 'px-1.5 py-0 text-[10px]' : 'px-2 py-0.5 text-xs'

  return (
    <span
      className={`shrink-0 rounded-full border bg-red-50 text-red-700 border-red-300 ${sizeClass}`}
      title="기밀 구간 절단이 적용되어 추가 녹음·전사를 받지 않습니다"
    >
      기밀 절단됨
    </span>
  )
}

export function MeetingTypeBadge({ type, typeMap }: { type: string; typeMap: Record<string, string> }) {
  return (
    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200">
      {typeMap[type] ?? type}
    </span>
  )
}

export function MeetingTypeSelector({
  meetingTypeList,
  selected,
  onSelect,
}: {
  meetingTypeList: { value: string; label: string }[]
  selected: string
  onSelect: (value: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {meetingTypeList.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => onSelect(t.value)}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
            selected === t.value
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-card text-muted-foreground border-border hover:border-blue-400'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function StatusFilterTabs({
  statusFilter,
  onSelect,
}: {
  statusFilter: string
  onSelect: (value: string) => void
}) {
  return (
    <>
      {STATUS_FILTER_TABS.map((tab) => (
        <button
          key={tab.value}
          onClick={() => onSelect(tab.value)}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            statusFilter === tab.value
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:bg-muted'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </>
  )
}

interface MeetingActionButtonsProps {
  meeting: Meeting
  isDesktop: boolean
  onEdit: (meeting: Meeting) => void
  onMove: (meeting: Meeting) => void
  onMoveProject: (meeting: Meeting) => void
  onDelete: (meeting: Meeting) => void
  onStop: (meeting: Meeting) => void
  onExport: (meeting: Meeting) => void
  /** list view always uses hover-based opacity; card view uses isDesktop toggle */
  forceHoverOpacity?: boolean
}

export function MeetingActionButtons({
  meeting,
  onEdit,
  onMove,
  onMoveProject,
  onDelete,
  onStop,
  onExport,
}: MeetingActionButtonsProps) {
  const me = useAuthStore((s) => s.user)
  // 소유권 게이팅: 서버가 403으로 강제하지만, 어포던스(수정/이동/삭제)는 권한이 있을 때만 노출한다.
  const canEdit = canEditMeeting(meeting, me)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right: number } | null>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onDismiss = () => setOpen(false)
    document.addEventListener('mousedown', onDocClick)
    window.addEventListener('resize', onDismiss)
    window.addEventListener('scroll', onDismiss, true)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      window.removeEventListener('resize', onDismiss)
      window.removeEventListener('scroll', onDismiss, true)
    }
  }, [open])

  if (!canEdit) return null

  return (
    <>
      {meeting.status === 'recording' && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onStop(meeting)
          }}
          className="px-2 py-0.5 rounded-md text-xs font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
        >
          종료
        </button>
      )}
      <div className="relative" ref={ref}>
        <button
          ref={triggerRef}
          aria-label="회의 메뉴"
          onClick={(e) => {
            e.stopPropagation()
            if (!open && triggerRef.current) {
              const rect = triggerRef.current.getBoundingClientRect()
              const MENU_H = 200
              const right = Math.max(8, window.innerWidth - rect.right)
              setPos(
                rect.bottom + MENU_H > window.innerHeight
                  ? { bottom: window.innerHeight - rect.top + 4, right }
                  : { top: rect.bottom + 4, right },
              )
            }
            setOpen((v) => !v)
          }}
          className="p-1 rounded text-muted-foreground hover:bg-muted transition-colors"
        >
          <MoreVertical className="w-4 h-4" />
        </button>
        {open && pos && (
          <div
            style={pos.top != null ? { top: pos.top, right: pos.right } : { bottom: pos.bottom, right: pos.right }}
            className="fixed z-50 w-36 rounded-md border border-border bg-card py-1 text-card-foreground shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              aria-label="정보 수정"
              onClick={(e) => {
                e.stopPropagation()
                setOpen(false)
                onEdit(meeting)
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted"
            >
              <Pencil className="w-3.5 h-3.5" /> 정보 수정
            </button>
            <button
              aria-label="폴더로 이동"
              onClick={(e) => {
                e.stopPropagation()
                setOpen(false)
                onMove(meeting)
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted"
            >
              <FolderInput className="w-4 h-4" /> 폴더로 이동
            </button>
            <button
              aria-label="프로젝트 이동"
              onClick={(e) => {
                e.stopPropagation()
                setOpen(false)
                onMoveProject(meeting)
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted"
            >
              <FolderInput className="w-4 h-4" /> 프로젝트 이동
            </button>
            <button
              aria-label="회의 내보내기"
              onClick={(e) => {
                e.stopPropagation()
                setOpen(false)
                onExport(meeting)
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted"
            >
              <PackageOpen className="w-3.5 h-3.5" /> 회의 내보내기
            </button>
            <button
              aria-label="삭제"
              onClick={(e) => {
                e.stopPropagation()
                setOpen(false)
                onDelete(meeting)
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50"
            >
              <Trash2 className="w-3.5 h-3.5" /> 휴지통
            </button>
          </div>
        )}
      </div>
    </>
  )
}
