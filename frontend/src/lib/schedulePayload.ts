import type { Meeting, RecurrenceRule } from '../api/meetings'

/**
 * 예약 스케줄 입력의 컨트롤드 폼 상태.
 * - enabled: 예약 토글(OFF=즉시 회의/예약 해제)
 * - date: YYYY-MM-DD (로컬), hour/minute: 24h zero-pad
 * - mode: auto=예약 시각 자동 시작, manual=1분 전 확인
 * - recurring + days(0=일~6=토): 매주 반복
 */
export interface ScheduleFormState {
  enabled: boolean
  date: string
  hour: string
  minute: string
  mode: 'auto' | 'manual'
  recurring: boolean
  days: number[]
}

/** 풀 트리플 페이로드. CREATE/EDIT 모두 이 셋으로 예약을 설정/해제한다. */
export interface SchedulePayload {
  scheduled_start_time: string | null
  auto_start_mode: 'auto' | 'manual' | null
  recurrence_rule: RecurrenceRule | null
}

/** 신규(즉시 회의) 기본 상태: 예약 OFF, 09:00, 수동, 비반복. */
export function emptyScheduleState(): ScheduleFormState {
  return { enabled: false, date: '', hour: '09', minute: '00', mode: 'manual', recurring: false, days: [] }
}

/**
 * 로컬 오늘(YYYY-MM-DD). toISOString 은 UTC라 날짜가 틀어질 수 있어
 * 반드시 로컬 getter(getFullYear/getMonth+1/getDate)로 조립한다.
 */
export function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * meeting → 폼 상태 복원. scheduled_start_time(UTC ISO)을 new Date 후
 * 로컬 getter로 date/hour/minute 를 뽑는다(toISOString 금지 — tz 어긋남 방지).
 * 미예약(scheduled_start_time 없음)이면 enabled=false 이고 date는 비운다.
 */
export function scheduleStateFromMeeting(meeting: Meeting): ScheduleFormState {
  const iso = meeting.scheduled_start_time
  const base = emptyScheduleState()
  if (!iso) {
    return {
      ...base,
      enabled: false,
      mode: meeting.auto_start_mode ?? 'manual',
      recurring: !!meeting.recurrence_rule,
      days: meeting.recurrence_rule?.days ?? [],
    }
  }
  const d = new Date(iso)
  return {
    enabled: true,
    date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    hour: String(d.getHours()).padStart(2, '0'),
    minute: String(d.getMinutes()).padStart(2, '0'),
    mode: meeting.auto_start_mode ?? 'manual',
    recurring: !!meeting.recurrence_rule,
    days: meeting.recurrence_rule?.days ?? [],
  }
}

/**
 * 폼 상태 → 풀 트리플 페이로드.
 * - enabled && date: scheduled_start_time(로컬 datetime → UTC ISO), auto_start_mode,
 *   recurrence_rule(반복 + 요일≥1 일 때만, 아니면 null)
 * - 그 외(미예약/날짜 없음): 셋 다 null(=예약 해제)
 * time 은 ISO(UTC)가 아니라 로컬 시/분(24h)에서 뽑아 tz 와 짝을 맞춘다.
 */
export function scheduleToPayload(state: ScheduleFormState): SchedulePayload {
  if (!state.enabled || !state.date) {
    return { scheduled_start_time: null, auto_start_mode: null, recurrence_rule: null }
  }
  return {
    scheduled_start_time: new Date(`${state.date}T${state.hour}:${state.minute}`).toISOString(),
    auto_start_mode: state.mode,
    recurrence_rule:
      state.recurring && state.days.length > 0
        ? {
            freq: 'weekly',
            days: [...state.days].sort((a, b) => a - b),
            time: `${state.hour}:${state.minute}`,
            tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }
        : null,
  }
}
