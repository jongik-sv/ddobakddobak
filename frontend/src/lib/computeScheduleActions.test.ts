import { describe, it, expect } from 'vitest'
import { computeScheduleActions } from './computeScheduleActions'
import type { ScheduledMeeting } from '../api/meetings/types'

const T0 = Date.UTC(2026, 5, 21, 10, 0, 0) // 기준 예약 시각(고정)

/** 테스트용 ScheduledMeeting 팩토리 — 스케줄링과 무관한 필드는 더미로 채운다. */
function meeting(over: Partial<ScheduledMeeting> & { id: number }): ScheduledMeeting {
  return {
    title: `회의 ${over.id}`,
    status: 'pending',
    meeting_type: 'general',
    created_by: { id: 1, name: 'tester' },
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
    created_at: new Date(T0).toISOString(),
    scheduled_start_time: new Date(T0).toISOString(),
    auto_start_mode: 'auto',
    recurrence_rule: null,
    schedule_dismissed_at: null,
    missed: false,
    ...over,
  }
}

const noCtx = { isOnLivePage: false, alreadyTriggered: new Set<number>() }

describe('computeScheduleActions', () => {
  describe('필수 필드 누락 시 건너뜀', () => {
    it('scheduled_start_time이 null이면 건너뛴다', () => {
      const m = meeting({ id: 1, scheduled_start_time: null })
      expect(computeScheduleActions([m], T0, noCtx)).toEqual([])
    })

    it('auto_start_mode가 null이면 건너뛴다', () => {
      const m = meeting({ id: 1, auto_start_mode: null })
      expect(computeScheduleActions([m], T0, noCtx)).toEqual([])
    })

    it('파싱 불가능한 scheduled_start_time이면 건너뛴다', () => {
      const m = meeting({ id: 1, scheduled_start_time: 'not-a-date' })
      expect(computeScheduleActions([m], T0, noCtx)).toEqual([])
    })
  })

  describe('isOnLivePage 가드', () => {
    it('라이브 페이지에 있으면 (트리거 조건 충족이어도) 전부 건너뛴다', () => {
      const auto = meeting({ id: 1, auto_start_mode: 'auto' })
      const manual = meeting({ id: 2, auto_start_mode: 'manual' })
      const ctx = { isOnLivePage: true, alreadyTriggered: new Set<number>() }
      expect(computeScheduleActions([auto, manual], T0, ctx)).toEqual([])
    })
  })

  describe('alreadyTriggered 가드', () => {
    it('이미 트리거한 id는 건너뛴다', () => {
      const m = meeting({ id: 7, auto_start_mode: 'auto' })
      const ctx = { isOnLivePage: false, alreadyTriggered: new Set([7]) }
      expect(computeScheduleActions([m], T0, ctx)).toEqual([])
    })
  })

  describe('auto 모드: 윈도우 [scheduled, scheduled + 60s)', () => {
    it('예약 시각 정각에 발화한다', () => {
      const m = meeting({ id: 1, auto_start_mode: 'auto' })
      expect(computeScheduleActions([m], T0, noCtx)).toEqual([{ meetingId: 1, mode: 'auto' }])
    })

    it('예약 시각 1ms 전에는 발화하지 않는다', () => {
      const m = meeting({ id: 1, auto_start_mode: 'auto' })
      expect(computeScheduleActions([m], T0 - 1, noCtx)).toEqual([])
    })

    it('예약 시각 +59,999ms에도 발화한다 (상한 직전)', () => {
      const m = meeting({ id: 1, auto_start_mode: 'auto' })
      expect(computeScheduleActions([m], T0 + 59_999, noCtx)).toEqual([{ meetingId: 1, mode: 'auto' }])
    })

    it('예약 시각 +60,000ms에는 발화하지 않는다 (상한 배타 → missed)', () => {
      const m = meeting({ id: 1, auto_start_mode: 'auto' })
      expect(computeScheduleActions([m], T0 + 60_000, noCtx)).toEqual([])
    })

    it('먼 과거(앱이 닫혀 있었던 케이스)에는 자동시작하지 않는다 (§2.2 가드)', () => {
      const m = meeting({ id: 1, auto_start_mode: 'auto' })
      expect(computeScheduleActions([m], T0 + 3 * 60 * 60 * 1000, noCtx)).toEqual([])
    })

    it('서버의 missed 플래그는 발화 판정에 영향을 주지 않는다 (윈도우 안이면 missed=true여도 발화)', () => {
      // missed는 strict-past(scheduled<now)라 정각 직후 폴부터 true가 된다. 이를 게이트로 쓰면
      // auto가 영영 안 뜨므로, 판정은 오직 scheduledMs 윈도우로만 한다.
      const m = meeting({ id: 1, auto_start_mode: 'auto', missed: true })
      expect(computeScheduleActions([m], T0 + 10_000, noCtx)).toEqual([{ meetingId: 1, mode: 'auto' }])
    })
  })

  describe('manual 모드: 윈도우 [scheduled - 60s, scheduled + 60s)', () => {
    it('예약 60s 전 정각에 발화한다 (하한 포함)', () => {
      const m = meeting({ id: 1, auto_start_mode: 'manual' })
      expect(computeScheduleActions([m], T0 - 60_000, noCtx)).toEqual([{ meetingId: 1, mode: 'manual' }])
    })

    it('예약 60,001ms 전에는 발화하지 않는다 (하한 직전)', () => {
      const m = meeting({ id: 1, auto_start_mode: 'manual' })
      expect(computeScheduleActions([m], T0 - 60_001, noCtx)).toEqual([])
    })

    it('예약 시각 정각에 발화한다', () => {
      const m = meeting({ id: 1, auto_start_mode: 'manual' })
      expect(computeScheduleActions([m], T0, noCtx)).toEqual([{ meetingId: 1, mode: 'manual' }])
    })

    it('예약 +59,999ms에도 발화한다 (상한 직전)', () => {
      const m = meeting({ id: 1, auto_start_mode: 'manual' })
      expect(computeScheduleActions([m], T0 + 59_999, noCtx)).toEqual([{ meetingId: 1, mode: 'manual' }])
    })

    it('예약 +60,000ms에는 발화하지 않는다 (상한 배타 → missed)', () => {
      const m = meeting({ id: 1, auto_start_mode: 'manual' })
      expect(computeScheduleActions([m], T0 + 60_000, noCtx)).toEqual([])
    })

    it('먼 과거에는 발화하지 않는다', () => {
      const m = meeting({ id: 1, auto_start_mode: 'manual' })
      expect(computeScheduleActions([m], T0 + 10 * 60_000, noCtx)).toEqual([])
    })
  })

  describe('여러 회의 동시 처리', () => {
    it('발화 조건을 충족한 회의만, 모드와 함께 반환한다', () => {
      const auto = meeting({ id: 1, auto_start_mode: 'auto' }) // 정각 → 발화
      const manualEarly = meeting({ id: 2, auto_start_mode: 'manual' }) // T0-60s에 발화하나 지금은 정각이라도 발화(윈도우 안)
      const future = meeting({
        id: 3,
        auto_start_mode: 'auto',
        scheduled_start_time: new Date(T0 + 5 * 60_000).toISOString(),
      }) // 5분 후 → 미발화
      const skipped = meeting({ id: 4, auto_start_mode: null }) // 모드 없음 → 미발화
      const result = computeScheduleActions([auto, manualEarly, future, skipped], T0, noCtx)
      expect(result).toEqual([
        { meetingId: 1, mode: 'auto' },
        { meetingId: 2, mode: 'manual' },
      ])
    })
  })
})
