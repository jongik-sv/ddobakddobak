import { describe, it, expect, vi, beforeEach } from 'vitest'

const invoke = vi.fn()
let plainReject: (() => Promise<never>) | null = null
let plainCalls = 0
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...a: unknown[]) => {
    if (plainReject) {
      plainCalls++
      return plainReject()
    }
    return invoke(...a)
  },
}))
vi.mock('../../config', () => ({ IS_TAURI: true }))

import { generateBoardLocal, detectLocalClaude, WhiteboardRunFailure } from './runner'

const material = { title: '회의', date: '2026-11-12', datetime: '2026-11-12 10:00', markdown: '## 핵심 요약\n- a' }
const goodJson = JSON.stringify({
  title: '회의', date: '2026-11-12', headline: '요약',
  zones: [{ title: '주제', kind: 'topic', items: [{ text: '내용', tag: null, who: null, due: null }] }],
})

describe('runner', () => {
  beforeEach(() => {
    invoke.mockReset()
    plainReject = null
    plainCalls = 0
  })

  it('detectLocalClaude: 경로 반환, 실패면 null', async () => {
    invoke.mockResolvedValueOnce('/usr/bin/claude')
    expect(await detectLocalClaude()).toBe('/usr/bin/claude')
    invoke.mockRejectedValueOnce(new Error('unknown command'))
    expect(await detectLocalClaude()).toBeNull()
  })

  it('성공: camelCase 인자로 호출하고 보드를 반환', async () => {
    invoke.mockResolvedValueOnce(goodJson)
    const board = await generateBoardLocal(material)
    expect(board.zones).toHaveLength(1)
    const [cmd, args] = invoke.mock.calls[0]
    expect(cmd).toBe('run_claude_whiteboard')
    expect(Object.keys(args).sort()).toEqual(['systemPrompt', 'timeoutSecs', 'userContent'])
  })

  it('스키마 위반이면 오류 문구를 붙여 1회 재요청', async () => {
    invoke.mockResolvedValueOnce('{"zones": []}').mockResolvedValueOnce(goodJson)
    await generateBoardLocal(material)
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(invoke.mock.calls[1][1].userContent).toContain('[이전 응답 오류]')
  })

  it('재요청 후에도 위반이면 format 실패 문구', async () => {
    invoke.mockResolvedValue('not json')
    const err = await generateBoardLocal(material).catch((e) => e)
    expect(err).toBeInstanceOf(WhiteboardRunFailure)
    expect(err.failure.kind).toBe('format')
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('Tauri 오류 객체를 분류한다(로그인 필요)', async () => {
    // vi.fn 은 reject/throw 값을 따로 추적해 비 Error 객체를 오류로 보고하므로 일반 함수로 거절한다.
    plainReject = () => Promise.reject({ kind: 'exit', message: 'exit 1', stderr_tail: 'Please run /login', stdout_tail: '' })
    const err = await generateBoardLocal(material).catch((e) => e)
    expect(err.failure.kind).toBe('auth')
    expect(plainCalls).toBe(1)
  })

  it('exit 0 stdout 이 로그인 안내면 재요청 없이 auth 실패', async () => {
    invoke.mockResolvedValue('Invalid API key · Please run /login')
    const err = await generateBoardLocal(material).catch((e) => e)
    expect(err).toBeInstanceOf(WhiteboardRunFailure)
    expect(err.failure.kind).toBe('auth')
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('exit 0 stdout 이 한도 문구면 재요청 없이 rate_limit 실패', async () => {
    invoke.mockResolvedValue('Claude usage limit reached. Your limit will reset at 5pm.')
    const err = await generateBoardLocal(material).catch((e) => e)
    expect(err.failure.kind).toBe('rate_limit')
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('재요청 응답이 한도 문구여도 format 이 아니라 rate_limit', async () => {
    invoke.mockResolvedValueOnce('not json').mockResolvedValueOnce('429 rate limit')
    const err = await generateBoardLocal(material).catch((e) => e)
    expect(err.failure.kind).toBe('rate_limit')
    expect(invoke).toHaveBeenCalledTimes(2)
  })
})
