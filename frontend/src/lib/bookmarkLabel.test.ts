import { describe, it, expect } from 'vitest'
import { computeBookmarkLabel, type BookmarkTranscript } from './bookmarkLabel'

const t = (content: string, started_at_ms: number, ended_at_ms: number): BookmarkTranscript => ({
  content,
  started_at_ms,
  ended_at_ms,
})

describe('computeBookmarkLabel', () => {
  it('빈 배열이면 빈 문자열', () => {
    expect(computeBookmarkLabel([], 1000)).toBe('')
  })

  it('덮는 transcript의 내용을 반환 (started 포함, ended 미만)', () => {
    const ts = [t('첫 발화', 0, 1000), t('둘째 발화', 1000, 2000)]
    expect(computeBookmarkLabel(ts, 1000)).toBe('둘째 발화')
    expect(computeBookmarkLabel(ts, 1999)).toBe('둘째 발화')
    expect(computeBookmarkLabel(ts, 0)).toBe('첫 발화')
  })

  it('40자 초과면 40자 + … 로 자름', () => {
    const long = '가'.repeat(60)
    const ts = [t(long, 0, 1000)]
    const out = computeBookmarkLabel(ts, 500)
    expect(out).toBe('가'.repeat(40) + '…')
    expect(out.length).toBe(41) // 40 + ellipsis
  })

  it('40자 이하는 그대로', () => {
    const ts = [t('짧은 내용', 0, 1000)]
    expect(computeBookmarkLabel(ts, 500)).toBe('짧은 내용')
  })

  it('내용 앞뒤 공백은 trim', () => {
    const ts = [t('  공백 있음  ', 0, 1000)]
    expect(computeBookmarkLabel(ts, 500)).toBe('공백 있음')
  })

  it('공백/무음 구간(덮는 것 없음)이면 시간상 가장 가까운 transcript', () => {
    const ts = [t('앞 발화', 0, 1000), t('뒤 발화', 5000, 6000)]
    // 1500: 앞(거리 500) vs 뒤(거리 3500) → 앞
    expect(computeBookmarkLabel(ts, 1500)).toBe('앞 발화')
    // 4800: 앞(거리 3800) vs 뒤(거리 200) → 뒤
    expect(computeBookmarkLabel(ts, 4800)).toBe('뒤 발화')
  })

  it('모든 transcript 앞이면 첫 transcript', () => {
    const ts = [t('첫', 1000, 2000), t('둘', 3000, 4000)]
    expect(computeBookmarkLabel(ts, 0)).toBe('첫')
  })

  it('모든 transcript 뒤면 마지막 transcript', () => {
    const ts = [t('첫', 1000, 2000), t('둘', 3000, 4000)]
    expect(computeBookmarkLabel(ts, 9999)).toBe('둘')
  })
})
