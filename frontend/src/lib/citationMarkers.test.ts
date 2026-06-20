import { describe, it, expect } from 'vitest'
import { parseCitationMarkers, stripCitationMarkers, dedupeMarkers, FOLDER_CITATION_RE, CITATION_RE, markerTimeToMs, speakerAtMs } from './citationMarkers'

describe('citationMarkers', () => {
  it('parses ms and speaker from a marker', () => {
    const r = parseCitationMarkers('결정 보류. ⟦t:125000|s:화자 1⟧')
    expect(r).toEqual([{ ms: 125000, speaker: '화자 1', index: 0, raw: '⟦t:125000|s:화자 1⟧' }])
  })
  it('parses multiple consecutive markers', () => {
    const r = parseCitationMarkers('합의. ⟦t:1000|s:화자 1⟧⟦t:2000|s:화자 2⟧')
    expect(r.map((m) => m.ms)).toEqual([1000, 2000])
  })
  it('strips markers and trims dangling space', () => {
    expect(stripCitationMarkers('결정 보류. ⟦t:125000|s:화자 1⟧')).toBe('결정 보류.')
  })
  it('parses ms and speaker from a / delimiter marker', () => {
    const r = parseCitationMarkers('결정 보류. ⟦t:125000/s:화자 1⟧')
    expect(r).toEqual([{ ms: 125000, speaker: '화자 1', index: 0, raw: '⟦t:125000/s:화자 1⟧' }])
  })
  it('parses both | and / delimiter markers in the same string', () => {
    const r = parseCitationMarkers('⟦t:1000|s:화자 1⟧⟦t:2000/s:화자 2⟧')
    expect(r.map((m) => m.ms)).toEqual([1000, 2000])
  })
  it('dedupes identical ms+speaker', () => {
    const r = dedupeMarkers([{ ms: 1, speaker: '화자 1' }, { ms: 1, speaker: '화자 1' }, { ms: 2, speaker: '화자 1' }])
    expect(r).toEqual([{ ms: 1, speaker: '화자 1' }, { ms: 2, speaker: '화자 1' }])
  })
})

describe('markerTimeToMs', () => {
  it('raw ms 숫자는 그대로 반환', () => {
    expect(markerTimeToMs('1847000')).toBe(1847000)
  })
  it('mm:ss → ms 변환', () => {
    expect(markerTimeToMs('30:47')).toBe(1847000)
  })
  it('hh:mm:ss → ms 변환', () => {
    expect(markerTimeToMs('1:02:03')).toBe(3723000)
  })
  it('backward-compat: 60000ms 유지', () => {
    expect(markerTimeToMs('60000')).toBe(60000)
  })
})

describe('CITATION_RE mm:ss 지원', () => {
  it('/ 구분자 mm:ss 마커 매칭', () => {
    const re = new RegExp(CITATION_RE.source, 'g')
    const m = re.exec('확정 ⟦t:30:47/s:화자 2⟧')
    expect(m?.[1]).toBe('30:47')
    expect(m?.[2]).toBe('화자 2')
  })
  it('| 구분자 mm:ss 마커 매칭', () => {
    const re = new RegExp(CITATION_RE.source, 'g')
    const m = re.exec('확정 ⟦t:30:47|s:화자 2⟧')
    expect(m?.[1]).toBe('30:47')
    expect(m?.[2]).toBe('화자 2')
  })
  it('parseCitationMarkers: mm:ss 마커 → ms 1847000', () => {
    const r = parseCitationMarkers('x ⟦t:30:47/s:화자 2⟧')
    expect(r).toEqual([{ ms: 1847000, speaker: '화자 2', index: 0, raw: '⟦t:30:47/s:화자 2⟧' }])
  })
  it('parseCitationMarkers backward-compat: | 구분자 ms 60000', () => {
    const r = parseCitationMarkers('⟦t:60000|s:화자 1⟧')
    expect(r[0].ms).toBe(60000)
  })
})

describe('FOLDER_CITATION_RE', () => {
  it('회의ID 포함 마커를 m/ms/speaker로 파싱한다', () => {
    const re = new RegExp(FOLDER_CITATION_RE.source, 'g')
    const m = re.exec('예산 확정. ⟦m:142/t:125000/s:화자 1⟧')
    expect(m?.[1]).toBe('142')
    expect(m?.[2]).toBe('125000')
    expect(m?.[3]).toBe('화자 1')
  })
})

describe('speakerAtMs', () => {
  const finals = [
    { started_at_ms: 0, ended_at_ms: 1000, speaker_label: '화자 1', speaker_name: '홍길동' },
    { started_at_ms: 2000, ended_at_ms: 3000, speaker_label: '화자 2', speaker_name: null },
    { started_at_ms: 5000, ended_at_ms: 6000, speaker_label: '화자 3', speaker_name: '김철수' },
  ]

  it('범위 안의 ms → 해당 final 반환 (speaker_label·speaker_name)', () => {
    expect(speakerAtMs(finals, 2500)).toEqual({ speaker_label: '화자 2', speaker_name: null })
    expect(speakerAtMs(finals, 5500)).toEqual({ speaker_label: '화자 3', speaker_name: '김철수' })
  })

  it('경계값 포함 (started/ended 양끝)', () => {
    expect(speakerAtMs(finals, 0)).toEqual({ speaker_label: '화자 1', speaker_name: '홍길동' })
    expect(speakerAtMs(finals, 1000)).toEqual({ speaker_label: '화자 1', speaker_name: '홍길동' })
  })

  it('범위 사이(gap) → started_at_ms가 가장 가까운 final 반환', () => {
    // 1400은 1000(화자1 끝)보다 2000(화자2 시작)에 가깝다 → 화자 2
    expect(speakerAtMs(finals, 1400)).toEqual({ speaker_label: '화자 2', speaker_name: null })
    // 1300: |1300-0|=1300 vs |1300-2000|=700 → 화자 2가 더 가까움
    expect(speakerAtMs(finals, 1300)).toEqual({ speaker_label: '화자 2', speaker_name: null })
    // 1700: |1700-0|=1700 vs |1700-2000|=300 → 화자 2가 더 가까움
    expect(speakerAtMs(finals, 1700)).toEqual({ speaker_label: '화자 2', speaker_name: null })
  })

  it('모든 범위 밖(끝보다 큰 ms) → started_at_ms 최근접 final', () => {
    expect(speakerAtMs(finals, 100000)).toEqual({ speaker_label: '화자 3', speaker_name: '김철수' })
  })

  it('모든 범위 밖(시작보다 작은 ms) → started_at_ms 최근접 final', () => {
    const shifted = [
      { started_at_ms: 10000, ended_at_ms: 11000, speaker_label: '화자 1', speaker_name: null },
      { started_at_ms: 12000, ended_at_ms: 13000, speaker_label: '화자 2', speaker_name: null },
    ]
    expect(speakerAtMs(shifted, 0)).toEqual({ speaker_label: '화자 1', speaker_name: null })
  })

  it('finals 비어있으면 null', () => {
    expect(speakerAtMs([], 1000)).toBeNull()
  })

  it('ended_at_ms가 null이면 ms===started_at_ms일 때만 in-range', () => {
    const nullEnded = [
      { started_at_ms: 5000, ended_at_ms: null, speaker_label: '화자 9', speaker_name: '나' },
    ]
    // 정확히 일치 → in-range hit
    expect(speakerAtMs(nullEnded, 5000)).toEqual({ speaker_label: '화자 9', speaker_name: '나' })
    // 불일치 → nearest fallback (단일 final이므로 동일 final)
    expect(speakerAtMs(nullEnded, 5001)).toEqual({ speaker_label: '화자 9', speaker_name: '나' })
  })

  it('겹침 구간(overlap): ms 포함 구간이 여럿이면 started_at_ms MAX(가장 늦게 시작) 선택', () => {
    // seqA·seqB가 overlap. ms=28000은 둘 다 포함하지만 정확히 seqB.started_at_ms → 화자 2가 정답.
    const seqA = { started_at_ms: 25500, ended_at_ms: 30000, speaker_label: '화자 1', speaker_name: null }
    const seqB = { started_at_ms: 28000, ended_at_ms: 40720, speaker_label: '화자 2', speaker_name: null }
    expect(speakerAtMs([seqA, seqB], 28000)).toEqual({ speaker_label: '화자 2', speaker_name: null })
    // MAX 선택은 배열 순서와 무관 — [seqB, seqA]로 줘도 동일하게 화자 2.
    expect(speakerAtMs([seqB, seqA], 28000)).toEqual({ speaker_label: '화자 2', speaker_name: null })
  })
})
