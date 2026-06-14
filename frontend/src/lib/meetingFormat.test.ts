import { describe, it, expect } from 'vitest'
import { formatDate } from './meetingFormat'

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
