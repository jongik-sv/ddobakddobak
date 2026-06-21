import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarClock } from 'lucide-react'
import { getScheduledMeetings } from '../../api/meetings'
import type { ScheduledMeeting } from '../../api/meetings'
import { StatusBadge } from './MeetingListUI'
import { formatScheduledStart, scheduleSummary } from '../../lib/meetingFormat'

/**
 * 다가오는 예약 회의 목록(아직 놓치지 않은 pending 예약).
 * 놓친 예약은 MissedScheduledMeetings가 담당하므로 여기선 제외한다.
 * 예약 항목이 없으면 아무것도 렌더하지 않는다.
 */
export function UpcomingScheduledMeetings() {
  const navigate = useNavigate()
  const [upcoming, setUpcoming] = useState<ScheduledMeeting[]>([])

  useEffect(() => {
    let alive = true
    getScheduledMeetings()
      .then((list) => {
        if (!alive) return
        const next = list
          .filter((m) => !m.missed)
          .sort((a, b) =>
            (a.scheduled_start_time ?? '').localeCompare(b.scheduled_start_time ?? ''),
          )
        setUpcoming(next)
      })
      .catch(() => {
        // 폴링 실패(오프라인 등)는 조용히 무시 — 섹션을 띄우지 않는다.
      })
    return () => {
      alive = false
    }
  }, [])

  if (upcoming.length === 0) return null

  return (
    <div className="mb-8">
      <div className="mb-3 flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-indigo-600" />
        <h2 className="text-lg font-semibold text-indigo-900">예약된 회의</h2>
      </div>
      <div className="space-y-2">
        {upcoming.map((m) => (
          <div
            key={m.id}
            onClick={() => navigate(`/meetings/${m.id}`)}
            className="rounded-lg border bg-card p-4 cursor-pointer hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-medium truncate min-w-0">{m.title}</h3>
              <StatusBadge status="pending" scheduled={true} />
            </div>
            {m.scheduled_start_time && (
              <p className="text-xs text-indigo-600 mt-1">
                ⏰ {formatScheduledStart(m.scheduled_start_time)} · {scheduleSummary(m)}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
