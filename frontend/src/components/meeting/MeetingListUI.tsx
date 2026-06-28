import { useState, useEffect, useRef } from 'react'
import { FolderInput, MoreVertical, Pencil, Trash2 } from 'lucide-react'
import type { Meeting } from '../../api/meetings'
import { canEditMeeting } from '../../api/meetings'
import { useAuthStore } from '../../stores/authStore'

export const STATUS_FILTER_TABS = [
  { value: '', label: '전체' },
  { value: 'recording', label: '녹음중' },
  { value: 'completed', label: '완료' },
  { value: 'pending', label: '대기중' },
] as const

export function StatusBadge({ status, scheduled }: { status: Meeting['status']; scheduled?: boolean }) {
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
              const MENU_H = 160
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
