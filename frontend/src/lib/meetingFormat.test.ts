import { describe, it, expect } from 'vitest'
import { formatDate, formatScheduledStart, scheduleSummary } from './meetingFormat'

describe('formatDate', () => {
  it('24시간제 — 오전/오후 표기 없음', () => {
    // 오전/오후 둘 다 후보가 되도록 오전/오후 시각 모두 검사 (TZ 무관)
    for (const iso of ['2026-06-10T05:48:31Z', '2026-06-11T01:07:53Z', '2026-06-10T20:30:00Z']) {
      expect(formatDate(iso)).not.toMatch(/오전|오후/)
    }
  })

  it('HH:MM 시간 포함', () => {
    expect(formatDate('2026-06-10T05:48:31Z')).toMatch(/\d{1,2}:\d{2}/)
  })
})

describe('formatScheduledStart', () => {
  it('로컬 시각을 YYYY.MM.DD HH:mm 으로 포맷(제로패딩, 24h) — Z 없는 입력은 로컬 파싱', () => {
    // Z 없는 ISO는 스펙상 로컬로 파싱되므로 러너 TZ와 무관하게 결정적
    expect(formatScheduledStart('2026-03-09T07:05:00')).toBe('2026.03.09 07:05')
  })

  it('두 자리 월/일/시/분도 그대로 유지', () => {
    expect(formatScheduledStart('2026-12-25T18:30:00')).toBe('2026.12.25 18:30')
  })
})

describe('scheduleSummary', () => {
  it('auto_start_mode=auto → 자동', () => {
    expect(scheduleSummary({ auto_start_mode: 'auto', recurrence_rule: null })).toBe('자동')
  })

  it('auto_start_mode=manual → 수동', () => {
    expect(scheduleSummary({ auto_start_mode: 'manual', recurrence_rule: null })).toBe('수동')
  })

  it('auto_start_mode 미지정 → 수동', () => {
    expect(scheduleSummary({ auto_start_mode: null, recurrence_rule: null })).toBe('수동')
  })

  it('주간 반복 → 자동 · 매주 + 정렬된 요일', () => {
    expect(
      scheduleSummary({
        auto_start_mode: 'auto',
        recurrence_rule: { freq: 'weekly', days: [3, 1], time: '09:00', tz: 'Asia/Seoul' },
      }),
    ).toBe('자동 · 매주 월, 수')
  })

  it('일간 반복 → 매일', () => {
    expect(
      scheduleSummary({
        auto_start_mode: 'manual',
        recurrence_rule: { freq: 'daily', time: '09:00', tz: 'Asia/Seoul' },
      }),
    ).toBe('수동 · 매일')
  })

  it('weekly 인데 days 비어있으면 반복 라벨 생략', () => {
    expect(
      scheduleSummary({
        auto_start_mode: 'auto',
        recurrence_rule: { freq: 'weekly', days: [], time: '09:00', tz: 'Asia/Seoul' },
      }),
    ).toBe('자동')
  })
})
