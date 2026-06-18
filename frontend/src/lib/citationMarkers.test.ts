import { describe, it, expect } from 'vitest'
import { parseCitationMarkers, stripCitationMarkers, dedupeMarkers } from './citationMarkers'

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
