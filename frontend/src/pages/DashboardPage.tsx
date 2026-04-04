import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Mic, CheckCircle2, Clock, FileText, type LucideIcon } from 'lucide-react'
import { getMeetings } from '../api/meetings'
import type { Meeting } from '../api/meetings'
import { usePromptTemplateStore } from '../stores/promptTemplateStore'
import { DashboardStatsSkeleton, DashboardMeetingsSkeleton } from '../components/ui/Skeleton'

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('ko-KR', {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
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

/* ── 상태 뱃지 ── */
const STATUS_BADGE: Record<string, { bg: string; text: string; label: string; pulse?: boolean }> = {
  recording: { bg: 'bg-red-100', text: 'text-red-700', label: '녹음중', pulse: true },
  completed: { bg: 'bg-green-100', text: 'text-green-700', label: '완료' },
  pending:   { bg: 'bg-gray-100', text: 'text-gray-500', label: '대기중' },
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_BADGE[status]
  if (!cfg) return null
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text} flex items-center gap-1`}>
      {cfg.pulse && (
        <span className="inline-block w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
      )}
      {cfg.label}
    </span>
  )
}

/* ── 상태별 카운트를 한 번의 순회로 계산 ── */
function countByStatus(meetings: Meeting[]) {
  let recording = 0
  let completed = 0
  for (const m of meetings) {
    if (m.status === 'recording') recording++
    else if (m.status === 'completed') completed++
  }
  return { recording, completed }
}

// 모듈 레벨 캐시 — 페이지 전환 시 이전 데이터 즉시 표시
let dashboardCache: { meetings: Meeting[]; totalCount: number } | null = null

export default function DashboardPage() {
  const navigate = useNavigate()
  const [meetings, setMeetings] = useState<Meeting[]>(dashboardCache?.meetings ?? [])
  const [totalCount, setTotalCount] = useState(dashboardCache?.totalCount ?? 0)
  const [isLoading, setIsLoading] = useState(!dashboardCache)
  const meetingTypeMap = usePromptTemplateStore((s) => s.meetingTypeMap)

  useEffect(() => {
    if (!dashboardCache) setIsLoading(true)
    getMeetings({ page: 1, per: 10 })
      .then((data) => {
        setMeetings(data.meetings)
        setTotalCount(data.meta.total)
        dashboardCache = { meetings: data.meetings, totalCount: data.meta.total }
      })
      .catch(() => {})
      .finally(() => setIsLoading(false))
  }, [])

  const { recording: recordingCount, completed: completedCount } = useMemo(
    () => countByStatus(meetings),
    [meetings],
  )
  const pendingCount = totalCount - recordingCount - completedCount
  const recentMeetings = meetings.slice(0, 5)
  const showSkeleton = isLoading && meetings.length === 0

  const statCards: Omit<StatCardProps, 'onClick'>[] = [
    { icon: FileText,    iconBg: 'bg-blue-50',  iconColor: 'text-blue-600',  label: '전체 회의', value: totalCount },
    { icon: Mic,         iconBg: 'bg-red-50',   iconColor: 'text-red-500',   label: '녹음중',    value: recordingCount },
    { icon: CheckCircle2,iconBg: 'bg-green-50', iconColor: 'text-green-600', label: '완료',      value: completedCount },
    { icon: Clock,       iconBg: 'bg-amber-50', iconColor: 'text-amber-600', label: '대기중',    value: pendingCount },
  ]
  const statLinks = ['/meetings', '/meetings?status=recording', '/meetings?status=completed', '/meetings?status=pending']

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-xl md:text-2xl font-bold">
          안녕하세요
        </h1>
        <p className="text-muted-foreground mt-1">회의 현황을 한눈에 확인하세요.</p>
      </div>

      {/* 통계 카드 */}
      {showSkeleton ? (
        <DashboardStatsSkeleton />
      ) : (
      <div className="overflow-x-auto mb-8">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6">
        {statCards.map((card, i) => (
          <StatCard key={card.label} {...card} onClick={() => navigate(statLinks[i])} />
        ))}
      </div>
      </div>
      )}

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
                    <StatusBadge status={meeting.status} />
                    <span className="text-xs text-muted-foreground">
                      {formatDate(meeting.created_at)}
                    </span>
                  </div>
                </div>
                {meeting.brief_summary && (
                  <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                    {meeting.brief_summary}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
