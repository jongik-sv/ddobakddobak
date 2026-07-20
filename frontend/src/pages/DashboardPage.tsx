import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Mic, CheckCircle2, Clock, FileText, Plus, WifiOff, CalendarClock, type LucideIcon } from 'lucide-react'
import { getMeetings } from '../api/meetings'
import type { Meeting } from '../api/meetings'
import { usePromptTemplateStore } from '../stores/promptTemplateStore'
import { useMeetingStore } from '../stores/meetingStore'
import { useProjectStore } from '../stores/projectStore'
import { CreateMeetingModal } from '../components/meeting/CreateMeetingModal'
import { StatusBadge } from '../components/meeting/MeetingListUI'
import { formatScheduledStart, scheduleSummary } from '../lib/meetingFormat'
import { stripCitationMarkers } from '../lib/citationMarkers'
import { MissedScheduledMeetings } from '../components/meeting/MissedScheduledMeetings'
import { UpcomingScheduledMeetings } from '../components/meeting/UpcomingScheduledMeetings'
import { DashboardStatsSkeleton, DashboardMeetingsSkeleton } from '../components/ui/Skeleton'
import { IS_TAURI, IS_MOBILE } from '../config'
import * as localStore from '../stt/localStore'

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('ko-KR', {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23', // 24시간제 — 오전/오후 제거
  })
}

/* ── 통계 카드 ── */
interface StatCardProps {
  icon: LucideIcon
  iconBg: string
  iconColor: string
  label: string
  value: number
  onClick: () => void
}

function StatCard({ icon: Icon, iconBg, iconColor, label, value, onClick }: StatCardProps) {
  return (
    <div
      onClick={onClick}
      className="rounded-lg border bg-card p-5 cursor-pointer hover:bg-muted/50 transition-colors"
    >
      <div className="flex items-center gap-3 mb-2">
        <div className={`rounded-md ${iconBg} p-2`}>
          <Icon className={`w-5 h-5 ${iconColor}`} />
        </div>
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
      </div>
      <p className="text-3xl font-bold">{value}</p>
    </div>
  )
}

type StatusCounts = Partial<Record<Meeting['status'], number>>

// 모듈 레벨 캐시 — 페이지 전환 시 이전 데이터 즉시 표시
let dashboardCache: { projectId: number | null; meetings: Meeting[]; totalCount: number; statusCounts: StatusCounts; scheduledCount: number } | null = null

export default function DashboardPage() {
  const navigate = useNavigate()
  const currentProjectId = useProjectStore((s) => s.currentProjectId)
  // 대시보드 캐시는 프로젝트 단위 — 다른 프로젝트의 캐시는 초기 표시에 쓰지 않는다(스코핑 누수 방지).
  const cached = dashboardCache?.projectId === currentProjectId ? dashboardCache : null
  const [meetings, setMeetings] = useState<Meeting[]>(cached?.meetings ?? [])
  const [totalCount, setTotalCount] = useState(cached?.totalCount ?? 0)
  const [statusCounts, setStatusCounts] = useState<StatusCounts>(cached?.statusCounts ?? {})
  // 예약된(pending) 회의 수 — meta.scheduled_count(백엔드 추가 중). 없으면 0.
  const [scheduledCount, setScheduledCount] = useState(cached?.scheduledCount ?? 0)
  const [isLoading, setIsLoading] = useState(!cached)
  const [showModal, setShowModal] = useState(false)
  // 오프라인(온디바이스) 회의 건수 — Android에서만. null이면 통계 카드 미표시(비대상 플랫폼).
  const [offlineCount, setOfflineCount] = useState<number | null>(null)
  const meetingTypeMap = usePromptTemplateStore((s) => s.meetingTypeMap)
  const meetingTypeList = usePromptTemplateStore((s) => s.meetingTypeList)
  const addMeeting = useMeetingStore((s) => s.addMeeting)

  useEffect(() => {
    if (dashboardCache?.projectId !== currentProjectId) setIsLoading(true)
    // show_all: 대시보드 통계·최근 회의는 중요 플래그와 무관하게 전체 회의를 집계한다.
    getMeetings({ page: 1, per: 10, project_id: currentProjectId ?? undefined, show_all: true })
      .then((data) => {
        const counts = data.meta.status_counts ?? {}
        // scheduled_count는 백엔드에서 추가 중 — 타입에 없을 수 있어 안전하게 옵셔널 접근.
        const scheduled = (data.meta as { scheduled_count?: number }).scheduled_count ?? 0
        setMeetings(data.meetings)
        setTotalCount(data.meta.total)
        setStatusCounts(counts)
        setScheduledCount(scheduled)
        dashboardCache = { projectId: currentProjectId, meetings: data.meetings, totalCount: data.meta.total, statusCounts: counts, scheduledCount: scheduled }
      })
      .catch(() => {})
      .finally(() => setIsLoading(false))
  }, [currentProjectId])

  // 오프라인 회의 건수(Android만). 로컬 fs 목록 길이.
  useEffect(() => {
    if (!(IS_TAURI && IS_MOBILE)) return
    localStore.listLocal()
      .then((metas) => setOfflineCount(metas.length))
      .catch(() => setOfflineCount(0))
  }, [])

  const recordingCount = statusCounts.recording ?? 0
  const completedCount = statusCounts.completed ?? 0
  const pendingCount = statusCounts.pending ?? 0
  // 대기중에서 예약 회의는 분리 — 예약중 카드로 따로 집계한다.
  const adjustedPending = Math.max(0, pendingCount - scheduledCount)
  // 예약 회의는 전용 "예약된 회의" 섹션에만 노출 → 최근 회의에서 제외(중복 방지).
  const recentMeetings = meetings
    .filter((m) => !(m.status === 'pending' && m.scheduled_start_time))
    .slice(0, 5)
  const showSkeleton = isLoading && meetings.length === 0

  const statCards: Omit<StatCardProps, 'onClick'>[] = [
    { icon: FileText,    iconBg: 'bg-muted',  iconColor: 'text-blue-600',  label: '전체 회의', value: totalCount },
    { icon: Mic,         iconBg: 'bg-muted',   iconColor: 'text-red-500',   label: '녹음중',    value: recordingCount },
    { icon: CheckCircle2,iconBg: 'bg-muted', iconColor: 'text-green-600', label: '완료',      value: completedCount },
    { icon: Clock,       iconBg: 'bg-muted', iconColor: 'text-amber-600', label: '대기중',    value: adjustedPending },
    { icon: CalendarClock, iconBg: 'bg-muted', iconColor: 'text-indigo-600', label: '예약중', value: scheduledCount },
    // 오프라인 회의 건수(Android만). 클릭 시 전용 홈으로.
    ...(offlineCount !== null
      ? [{ icon: WifiOff, iconBg: 'bg-muted', iconColor: 'text-slate-600', label: '오프라인 회의', value: offlineCount }]
      : []),
  ]
  const statLinks = ['/meetings', '/meetings?status=recording', '/meetings?status=completed', '/meetings?status=pending',
    '/meetings?status=pending',
    ...(offlineCount !== null ? ['/local-meetings'] : [])]

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 lg:p-8">
      <div className="mb-8 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold">
            안녕하세요
          </h1>
          <p className="text-muted-foreground mt-1">회의 현황을 한눈에 확인하세요.</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors min-h-[44px]"
        >
          <Plus className="w-4 h-4" />
          회의 생성
        </button>
      </div>

      {/* 놓친 예약 회의 안내 (없으면 미표시) */}
      <MissedScheduledMeetings />

      {/* 통계 카드 */}
      {showSkeleton ? (
        <DashboardStatsSkeleton />
      ) : (
      <div className="overflow-x-auto mb-8">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 md:gap-6">
        {statCards.map((card, i) => (
          <StatCard key={card.label} {...card} onClick={() => navigate(statLinks[i])} />
        ))}
      </div>
      </div>
      )}

      {/* 예약된 회의 (다가오는 예약, 없으면 미표시) */}
      {!showSkeleton && <UpcomingScheduledMeetings />}

      {/* 최근 회의 */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">최근 회의</h2>
          <button
            onClick={() => navigate('/meetings')}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors min-h-[44px] inline-flex items-center"
          >
            전체 보기 &rarr;
          </button>
        </div>

        {showSkeleton ? (
          <DashboardMeetingsSkeleton />
        ) : recentMeetings.length === 0 ? (
          <div className="rounded-lg border bg-card p-8 text-center">
            <p className="text-muted-foreground">아직 회의가 없습니다.</p>
            <button
              onClick={() => navigate('/meetings')}
              className="mt-3 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors"
            >
              첫 회의 시작하기
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {recentMeetings.map((meeting) => (
              <div
                key={meeting.id}
                onClick={() => navigate(`/meetings/${meeting.id}`)}
                className="rounded-lg border bg-card p-4 cursor-pointer hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <h3 className="font-medium truncate">{meeting.title}</h3>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200 shrink-0">
                      {meetingTypeMap[meeting.meeting_type] ?? meeting.meeting_type}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <StatusBadge status={meeting.status} scheduled={meeting.status === 'pending' && !!meeting.scheduled_start_time} paused={meeting.status === 'recording' && !!meeting.paused_at} summarizing={meeting.summarizing} />
                    <span className="text-xs text-muted-foreground">
                      {formatDate(meeting.created_at)}
                    </span>
                  </div>
                </div>
                {meeting.status === 'pending' && meeting.scheduled_start_time && (
                  <p className="text-xs text-indigo-600 mt-1">
                    ⏰ {formatScheduledStart(meeting.scheduled_start_time)} · {scheduleSummary(meeting)}
                  </p>
                )}
                {meeting.brief_summary && (
                  <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                    {stripCitationMarkers(meeting.brief_summary)}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <CreateMeetingModal
          folderId={null}
          meetingTypeList={meetingTypeList}
          onClose={() => setShowModal(false)}
          onCreated={(meeting) => {
            addMeeting(meeting)
            // 예약 회의는 라이브로 점프하지 않고 목록에 추가만(스케줄러가 예약 시각에 시작).
            if (!meeting.scheduled_start_time) navigate(`/meetings/${meeting.id}/live`)
          }}
        />
      )}
    </div>
  )
}
