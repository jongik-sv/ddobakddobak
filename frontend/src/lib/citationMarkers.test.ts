import { describe, it, expect } from 'vitest'
import { parseCitationMarkers, stripCitationMarkers, dedupeMarkers, FOLDER_CITATION_RE, CITATION_RE, markerTimeToMs } from './citationMarkers'

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
