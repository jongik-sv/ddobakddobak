import { describe, it, expect } from 'vitest'
import {
  resolveSttMode,
  resolveSttModeWithReason,
  type SttManualMode,
  type SttActiveMode,
  type SttModeReason,
} from './sttModeResolver'

/**
 * 진리표 전수: manualMode(3) × serverReachable(2) × localCapable(2) = 12 케이스.
 *
 * 결정 규칙:
 *   local  & capable      -> local  / manual
 *   local  & !capable     -> server / local-incapable
 *   server (anything)     -> server / manual
 *   auto   & !reachable & capable -> local  / auto-offline
 *   auto   (그 외)         -> server / auto-online
 */
describe('resolveSttMode - 진리표 전수', () => {
  type Row = {
    manualMode: SttManualMode
    serverReachable: boolean
    localCapable: boolean
    mode: SttActiveMode
    reason: SttModeReason
  }

  const table: Row[] = [
    // manual = 'local'
    { manualMode: 'local', serverReachable: true, localCapable: true, mode: 'local', reason: 'manual' },
    { manualMode: 'local', serverReachable: true, localCapable: false, mode: 'server', reason: 'local-incapable' },
    { manualMode: 'local', serverReachable: false, localCapable: true, mode: 'local', reason: 'manual' },
    { manualMode: 'local', serverReachable: false, localCapable: false, mode: 'server', reason: 'local-incapable' },

    // manual = 'server' — 무조건 server/manual
    { manualMode: 'server', serverReachable: true, localCapable: true, mode: 'server', reason: 'manual' },
    { manualMode: 'server', serverReachable: true, localCapable: false, mode: 'server', reason: 'manual' },
    { manualMode: 'server', serverReachable: false, localCapable: true, mode: 'server', reason: 'manual' },
    { manualMode: 'server', serverReachable: false, localCapable: false, mode: 'server', reason: 'manual' },

    // manual = 'auto'
    { manualMode: 'auto', serverReachable: true, localCapable: true, mode: 'server', reason: 'auto-online' },
    { manualMode: 'auto', serverReachable: true, localCapable: false, mode: 'server', reason: 'auto-online' },
    { manualMode: 'auto', serverReachable: false, localCapable: true, mode: 'local', reason: 'auto-offline' },
    { manualMode: 'auto', serverReachable: false, localCapable: false, mode: 'server', reason: 'auto-online' },
  ]

  it('정확히 12개 조합을 전수 검증한다', () => {
    expect(table).toHaveLength(12)
  })

  for (const row of table) {
    const label = `manual=${row.manualMode} reachable=${row.serverReachable} capable=${row.localCapable}`

    it(`${label} -> mode=${row.mode}`, () => {
      const input = {
        manualMode: row.manualMode,
        serverReachable: row.serverReachable,
        localCapable: row.localCapable,
      }
      expect(resolveSttMode(input)).toBe(row.mode)
    })

    it(`${label} -> reason=${row.reason}`, () => {
      const input = {
        manualMode: row.manualMode,
        serverReachable: row.serverReachable,
        localCapable: row.localCapable,
      }
      expect(resolveSttModeWithReason(input)).toEqual({
        mode: row.mode,
        reason: row.reason,
      })
    })
  }
})

describe('resolveSttMode - 핵심 불변식', () => {
  it("manual='server'는 capable/reachable과 무관하게 항상 server", () => {
    const combos = [
      { serverReachable: true, localCapable: true },
      { serverReachable: true, localCapable: false },
      { serverReachable: false, localCapable: true },
      { serverReachable: false, localCapable: false },
    ]
    for (const c of combos) {
      expect(resolveSttMode({ manualMode: 'server', ...c })).toBe('server')
    }
  })

  it("manual='local'은 capable이면 local, 아니면 server 폴백", () => {
    expect(
      resolveSttMode({ manualMode: 'local', serverReachable: true, localCapable: true }),
    ).toBe('local')
    expect(
      resolveSttMode({ manualMode: 'local', serverReachable: true, localCapable: false }),
    ).toBe('server')
  })

  it("auto: 서버 도달 가능하면 capable여도 server 유지", () => {
    expect(
      resolveSttModeWithReason({ manualMode: 'auto', serverReachable: true, localCapable: true }),
    ).toEqual({ mode: 'server', reason: 'auto-online' })
  })

  it("auto: 서버 미도달 + 로컬 불가면 server (로컬로 못 넘어감)", () => {
    expect(
      resolveSttModeWithReason({ manualMode: 'auto', serverReachable: false, localCapable: false }),
    ).toEqual({ mode: 'server', reason: 'auto-online' })
  })

  it("auto: 서버 미도달 + 로컬 가용일 때만 local 폴백", () => {
    expect(
      resolveSttModeWithReason({ manualMode: 'auto', serverReachable: false, localCapable: true }),
    ).toEqual({ mode: 'local', reason: 'auto-offline' })
  })

  it('순수 함수: 동일 입력은 항상 동일 출력', () => {
    const input = { manualMode: 'auto' as const, serverReachable: false, localCapable: true }
    const a = resolveSttModeWithReason(input)
    const b = resolveSttModeWithReason(input)
    expect(a).toEqual(b)
  })
})
