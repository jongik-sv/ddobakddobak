import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Mic, CheckCircle2, Clock, FileText } from 'lucide-react'
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

  const recordingCount = meetings.filter((m) => m.status === 'recording').length
  const completedCount = meetings.filter((m) => m.status === 'completed').length
  const recentMeetings = meetings.slice(0, 5)

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">
          안녕하세요
        </h1>
        <p className="text-muted-foreground mt-1">회의 현황을 한눈에 확인하세요.</p>
      </div>

      {/* 통계 카드 */}
      {isLoading && meetings.length === 0 ? (
        <DashboardStatsSkeleton />
      ) : (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div
          onClick={() => navigate('/meetings')}
          className="rounded-lg border bg-card p-5 cursor-pointer hover:bg-muted/50 transition-colors"
        >
          <div className="flex items-center gap-3 mb-2">
            <div className="rounded-md bg-blue-50 p-2">
              <FileText className="w-5 h-5 text-blue-600" />
            </div>
            <span className="text-sm font-medium text-muted-foreground">전체 회의</span>
          </div>
          <p className="text-3xl font-bold">{totalCount}</p>
        </div>

        <div
          onClick={() => navigate('/meetings?status=recording')}
          className="rounded-lg border bg-card p-5 cursor-pointer hover:bg-muted/50 transition-colors"
        >
          <div className="flex items-center gap-3 mb-2">
            <div className="rounded-md bg-red-50 p-2">
              <Mic className="w-5 h-5 text-red-500" />
            </div>
            <span className="text-sm font-medium text-muted-foreground">녹음중</span>
          </div>
          <p className="text-3xl font-bold">{recordingCount}</p>
        </div>

        <div
          onClick={() => navigate('/meetings?status=completed')}
          className="rounded-lg border bg-card p-5 cursor-pointer hover:bg-muted/50 transition-colors"
        >
          <div className="flex items-center gap-3 mb-2">
            <div className="rounded-md bg-green-50 p-2">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
            </div>
            <span className="text-sm font-medium text-muted-foreground">완료</span>
          </div>
          <p className="text-3xl font-bold">{completedCount}</p>
        </div>

        <div
          onClick={() => navigate('/meetings?status=pending')}
          className="rounded-lg border bg-card p-5 cursor-pointer hover:bg-muted/50 transition-colors"
        >
          <div className="flex items-center gap-3 mb-2">
            <div className="rounded-md bg-amber-50 p-2">
              <Clock className="w-5 h-5 text-amber-600" />
            </div>
            <span className="text-sm font-medium text-muted-foreground">대기중</span>
          </div>
          <p className="text-3xl font-bold">
            {totalCount - recordingCount - completedCount}
          </p>
        </div>
      </div>
      )}

      {/* 최근 회의 */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">최근 회의</h2>
          <button
            onClick={() => navigate('/meetings')}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            전체 보기 &rarr;
          </button>
        </div>

        {isLoading && meetings.length === 0 ? (
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
                    {meeting.status === 'recording' && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 flex items-center gap-1">
                        <span className="inline-block w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                        녹음중
                      </span>
                    )}
                    {meeting.status === 'completed' && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                        완료
                      </span>
                    )}
                    {meeting.status === 'pending' && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                        대기중
                      </span>
                    )}
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
