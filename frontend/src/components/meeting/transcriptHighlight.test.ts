import { describe, it, expect } from 'vitest'
import { resolveHighlightIndex } from './transcriptHighlight'

const segs = [
  { started_at_ms: 0, ended_at_ms: 3000 },
  { started_at_ms: 5000, ended_at_ms: 8000 }, // [3000,5000) 무음 갭
  { started_at_ms: 8000, ended_at_ms: 11000 },
]

describe('resolveHighlightIndex', () => {
  it('빈 배열이면 -1', () => {
    expect(resolveHighlightIndex([], 1000)).toBe(-1)
  })

  it('포함 구간을 반환한다', () => {
    expect(resolveHighlightIndex(segs, 1500)).toBe(0)
    expect(resolveHighlightIndex(segs, 6000)).toBe(1)
    expect(resolveHighlightIndex(segs, 8000)).toBe(2) // 경계: 8000은 seg2에 포함(seg1은 배타적 상한)
  })

  it('무음 갭에 떨어진 ms는 started_at_ms가 가장 가까운 구간을 선택한다(오디오는 seek되는데 전사만 선택 안 되던 버그)', () => {
    // speakerAtMs와 동일하게 "가장 가까운 started_at_ms" 기준(배지 화자와 하이라이트 일치 목적).
    // 4000: |5000-4000|=1000 < |0-4000|=4000 → seg1.
    expect(resolveHighlightIndex(segs, 4000)).toBe(1)
    // 3200: |5000-3200|=1800 < |0-3200|=3200 → seg1 (다음 발화).
    expect(resolveHighlightIndex(segs, 3200)).toBe(1)
  })

  it('첫 발화 이전(>0)이면 첫 구간을 선택한다', () => {
    const later = [
      { started_at_ms: 2000, ended_at_ms: 4000 },
      { started_at_ms: 4000, ended_at_ms: 6000 },
    ]
    expect(resolveHighlightIndex(later, 500)).toBe(0)
  })

  it('마지막 발화 이후면 마지막 구간을 선택한다', () => {
    expect(resolveHighlightIndex(segs, 50000)).toBe(2)
  })

  it('currentTimeMs가 0/음수(초기·미재생)면 포함 구간이 없는 한 -1 (기존 동작 보존)', () => {
    const later = [{ started_at_ms: 2000, ended_at_ms: 4000 }]
    expect(resolveHighlightIndex(later, 0)).toBe(-1)
    expect(resolveHighlightIndex(later, -1)).toBe(-1)
    // 단, 0을 포함하는 구간(started_at_ms=0)이 있으면 그 구간을 선택
    expect(resolveHighlightIndex(segs, 0)).toBe(0)
  })

  it('overlap 시 started_at_ms가 가장 큰(가장 늦게 시작한) 구간을 선택한다', () => {
    const overlap = [
      { started_at_ms: 1000, ended_at_ms: 4000 },
      { started_at_ms: 3500, ended_at_ms: 6000 }, // 500ms overlap
    ]
    expect(resolveHighlightIndex(overlap, 3800)).toBe(1)
  })

  it('ended_at_ms가 null이면 정확히 started_at_ms일 때만 포함, 그 외엔 nearest', () => {
    const live = [
      { started_at_ms: 1000, ended_at_ms: 3000 },
      { started_at_ms: 3000, ended_at_ms: null },
    ]
    expect(resolveHighlightIndex(live, 3000)).toBe(1) // 정확히 일치 → 포함
    expect(resolveHighlightIndex(live, 5000)).toBe(1) // 초과 → nearest(3000)
  })
})
