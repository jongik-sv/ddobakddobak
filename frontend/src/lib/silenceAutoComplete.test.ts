import { describe, it, expect } from 'vitest'
import { newSilenceState, tickSilence } from './silenceAutoComplete'

const FIVE_MIN = 5 * 60_000

describe('tickSilence', () => {
  it('연속 무음 5분 도달 시 true', () => {
    const s = newSilenceState()
    let fired = false
    for (let t = 0; t < FIVE_MIN; t += 1000) fired = tickSilence(s, 1000, false)
    expect(fired).toBe(true)
  })
  it('5분 직전까지는 false', () => {
    const s = newSilenceState()
    let fired = false
    for (let t = 0; t < FIVE_MIN - 1000; t += 1000) fired = tickSilence(s, 1000, false)
    expect(fired).toBe(false)
  })
  it('유음 1회로 카운터 리셋', () => {
    const s = newSilenceState()
    for (let t = 0; t < FIVE_MIN - 1000; t += 1000) tickSilence(s, 1000, false)
    tickSilence(s, 1000, true) // 유음 → 리셋
    expect(s.silentMs).toBe(0)
    expect(tickSilence(s, 1000, false)).toBe(false)
  })
})
