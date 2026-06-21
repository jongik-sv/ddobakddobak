import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarClock } from 'lucide-react'
import { getScheduledMeetings, dismissSchedule } from '../../api/meetings'
import type { ScheduledMeeting } from '../../api/meetings'

/**
 * 앱이 닫혀 있어 자동시작하지 못한 "놓친 예약 회의"를 안내한다.
 * 각 항목: [지금 시작](라이브 autoStart) / [닫기](dismissSchedule).
 * 놓친 항목이 없으면 아무것도 렌더하지 않는다.
 */
export function MissedScheduledMeetings() {
  const navigate = useNavigate()
  const [missed, setMissed] = useState<ScheduledMeeting[]>([])

  useEffect(() => {
    let alive = true
    getScheduledMeetings()
      .then((list) => {
        if (alive) setMissed(list.filter((m) => m.missed))
      })
      .catch(() => {
        // 폴링 실패(오프라인 등)는 조용히 무시 — 안내를 띄우지 않는다.
      })
    return () => {
      alive = false
    }
  }, [])

  if (missed.length === 0) return null

  async function handleDismiss(id: number) {
    try {
      await dismissSchedule(id)
    } catch {
      // 닫기 실패해도 로컬 목록에서는 제거(다음 폴링에서 재확인).
    }
    setMissed((prev) => prev.filter((m) => m.id !== id))
  }

  function handleStartNow(id: number) {
    navigate(`/meetings/${id}/live`, { state: { autoStart: true } })
  }

  return (
    <div className="mb-8 rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="mb-3 flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-amber-600" />
        <h2 className="text-sm font-semibold text-amber-900">놓친 예약 회의</h2>
      </div>
      <ul className="space-y-2">
        {missed.map((m) => (
          <li
            key={m.id}
            className="flex items-center justify-between gap-3 rounded-md bg-card px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{m.title}</p>
              {m.scheduled_start_time && (
                <p className="text-xs text-muted-foreground">
                  {new Date(m.scheduled_start_time).toLocaleString()}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => handleStartNow(m.id)}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                지금 시작
              </button>
              <button
                onClick={() => handleDismiss(m.id)}
                className="rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/50 transition-colors"
              >
                닫기
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
