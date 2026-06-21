import { describe, it, expect } from 'vitest'
import {
  emptyScheduleState,
  todayLocal,
  scheduleStateFromMeeting,
  scheduleToPayload,
  type ScheduleFormState,
} from './schedulePayload'
import type { Meeting } from '../api/meetings'

// 로컬 오늘(YYYY-MM-DD) — todayLocal 과 동일 계산을 테스트 쪽에서 재현(타임존 의존 회피).
function localToday() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function makeMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 1,
    title: '회의',
    status: 'pending',
    meeting_type: 'general',
    created_by: { id: 1, name: '사용자1' },
    brief_summary: null,
    folder_id: null,
    audio_duration_ms: 0,
    last_transcript_end_ms: 0,
    last_sequence_number: 0,
    memo: null,
    attendees: null,
    shared: true,
    locked: false,
    locked_at: null,
    important: false,
    started_at: null,
    ended_at: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('emptyScheduleState', () => {
  it('기본값(예약 OFF, 09:00, manual, 비반복)', () => {
    expect(emptyScheduleState()).toEqual({
      enabled: false,
      date: '',
      hour: '09',
      minute: '00',
      mode: 'manual',
      recurring: false,
      days: [],
    })
  })
})

describe('todayLocal', () => {
  it('로컬 기준 YYYY-MM-DD (toISOString 슬라이스 아님)', () => {
    expect(todayLocal()).toBe(localToday())
    expect(todayLocal()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('scheduleToPayload — CREATE 동작 보존(라인 86-103)', () => {
  it('toggle OFF → 셋 다 null(=예약 해제, CREATE에서는 키를 빼는 데 사용)', () => {
    const state: ScheduleFormState = { ...emptyScheduleState(), enabled: false, date: '2026-06-25' }
    expect(scheduleToPayload(state)).toEqual({
      scheduled_start_time: null,
      auto_start_mode: null,
      recurrence_rule: null,
    })
  })

  it('enabled 인데 date 없으면 셋 다 null', () => {
    const state: ScheduleFormState = { ...emptyScheduleState(), enabled: true, date: '' }
    expect(scheduleToPayload(state)).toEqual({
      scheduled_start_time: null,
      auto_start_mode: null,
      recurrence_rule: null,
    })
  })

  it('on + 비반복 → scheduled_start_time(UTC ISO)+auto_start_mode, recurrence_rule=null', () => {
    const state: ScheduleFormState = {
      enabled: true,
      date: '2026-06-25',
      hour: '10',
      minute: '00',
      mode: 'auto',
      recurring: false,
      days: [],
    }
    const payload = scheduleToPayload(state)
    expect(payload.scheduled_start_time).toBe(new Date('2026-06-25T10:00').toISOString())
    expect(payload.scheduled_start_time).toMatch(/T.*Z$/)
    expect(payload.auto_start_mode).toBe('auto')
    expect(payload.recurrence_rule).toBeNull()
  })

  it('on + 반복(요일≥1) → recurrence_rule{freq,days(정렬),time:HH:mm,tz}', () => {
    const state: ScheduleFormState = {
      enabled: true,
      date: '2026-06-25',
      hour: '10',
      minute: '30',
      mode: 'manual',
      recurring: true,
      days: [3, 1],
    }
    const payload = scheduleToPayload(state)
    expect(payload.scheduled_start_time).toBe(new Date('2026-06-25T10:30').toISOString())
    expect(payload.auto_start_mode).toBe('manual')
    expect(payload.recurrence_rule).toEqual({
      freq: 'weekly',
      days: [1, 3],
      time: '10:30',
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })
  })

  it('반복 체크했지만 요일 0개 → recurrence_rule=null (1회성)', () => {
    const state: ScheduleFormState = {
      enabled: true,
      date: '2026-06-25',
      hour: '09',
      minute: '00',
      mode: 'manual',
      recurring: true,
      days: [],
    }
    expect(scheduleToPayload(state).recurrence_rule).toBeNull()
  })
})

describe('scheduleStateFromMeeting', () => {
  it('scheduled_start_time 없으면 enabled=false + 오늘 기본 안 채움(빈 date)', () => {
    const state = scheduleStateFromMeeting(makeMeeting({ scheduled_start_time: null }))
    expect(state.enabled).toBe(false)
    expect(state.date).toBe('')
    expect(state.mode).toBe('manual')
    expect(state.recurring).toBe(false)
    expect(state.days).toEqual([])
  })

  it('scheduled_start_time(UTC ISO)을 로컬 date/hour/minute로 복원, mode/recurring/days 복원', () => {
    const iso = new Date('2026-06-25T14:05').toISOString()
    const state = scheduleStateFromMeeting(
      makeMeeting({
        scheduled_start_time: iso,
        auto_start_mode: 'auto',
        recurrence_rule: { freq: 'weekly', days: [2, 4], time: '14:05', tz: 'Asia/Seoul' },
      }),
    )
    expect(state.enabled).toBe(true)
    expect(state.date).toBe('2026-06-25')
    expect(state.hour).toBe('14')
    expect(state.minute).toBe('05')
    expect(state.mode).toBe('auto')
    expect(state.recurring).toBe(true)
    expect(state.days).toEqual([2, 4])
  })

  it('auto_start_mode 없으면 manual 기본', () => {
    const iso = new Date('2026-06-25T09:00').toISOString()
    const state = scheduleStateFromMeeting(makeMeeting({ scheduled_start_time: iso }))
    expect(state.mode).toBe('manual')
  })
})

describe('라운드트립 (from→to→from)', () => {
  it('비반복 manual 안정', () => {
    const iso = new Date('2026-06-25T10:00').toISOString()
    const s1 = scheduleStateFromMeeting(makeMeeting({ scheduled_start_time: iso, auto_start_mode: 'manual' }))
    const p = scheduleToPayload(s1)
    const s2 = scheduleStateFromMeeting(
      makeMeeting({
        scheduled_start_time: p.scheduled_start_time,
        auto_start_mode: p.auto_start_mode,
        recurrence_rule: p.recurrence_rule,
      }),
    )
    expect(s2).toEqual(s1)
  })

  it('auto + 반복 안정', () => {
    const iso = new Date('2026-06-25T18:45').toISOString()
    const s1 = scheduleStateFromMeeting(
      makeMeeting({
        scheduled_start_time: iso,
        auto_start_mode: 'auto',
        // days 는 항상 정렬된 형태로 영속된다(scheduleToPayload 가 정렬). 정렬형으로 시드.
        recurrence_rule: { freq: 'weekly', days: [0, 5, 6], time: '18:45', tz: 'Asia/Seoul' },
      }),
    )
    const p = scheduleToPayload(s1)
    const s2 = scheduleStateFromMeeting(
      makeMeeting({
        scheduled_start_time: p.scheduled_start_time,
        auto_start_mode: p.auto_start_mode,
        recurrence_rule: p.recurrence_rule,
      }),
    )
    expect(s2).toEqual(s1)
  })
})
