import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../api/whiteboard', async () => {
  const actual = await vi.importActual<typeof import('../api/whiteboard')>('../api/whiteboard')
  return { ...actual, postWhiteboard: vi.fn(), getWhiteboard: vi.fn() }
})
vi.mock('../lib/download', () => ({ downloadBlob: vi.fn(), downloadText: vi.fn() }))

const channel = vi.hoisted(() => ({
  handlers: null as null | { received: (d: unknown) => void; connected?: () => void; rejected?: () => void },
  unsub: vi.fn(),
  creates: 0,
}))
vi.mock('../lib/actionCableAuth', () => ({
  createAuthenticatedConsumer: () => ({
    subscriptions: {
      create: (_p: unknown, h: never) => {
        channel.handlers = h
        channel.creates += 1
        return { unsubscribe: channel.unsub }
      },
    },
    disconnect: vi.fn(),
  }),
}))

import { getWhiteboard, postWhiteboard } from '../api/whiteboard'
import { POLL_INTERVAL_MS, POLL_MAX_MS, useWhiteboardStore } from './whiteboardStore'
import { useAuthStore } from './authStore'

const board = {
  title: 't', date: '2026-11-12', headline: 'h',
  zones: [{ title: 'z', kind: 'topic', items: [{ text: 't', tag: null, who: null, due: null }] }],
}
const material = { title: 't', date: '2026-11-12', datetime: 'd', markdown: '## a' } as never

async function startRunning() {
  vi.mocked(postWhiteboard).mockResolvedValue({ status: 'running', digest: 'd1' })
  await useWhiteboardStore.getState().startServer(1, material, 'f.html')
}

describe('whiteboardStore 서버 폴링', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    channel.handlers = null
    channel.creates = 0
    useWhiteboardStore.getState().disposeAll()
    vi.mocked(getWhiteboard).mockResolvedValue({ status: 'running', digest: 'd1', stale: false })
  })
  afterEach(() => {
    useWhiteboardStore.getState().disposeAll()
    vi.useRealTimers()
  })

  it('running 동안 15초마다 GET 하고 done 이 오면 반영·폴링 종료', async () => {
    await startRunning()
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(getWhiteboard).toHaveBeenCalledTimes(1)
    expect(useWhiteboardStore.getState().entries[1].status).toBe('running')
    vi.mocked(getWhiteboard).mockResolvedValue({ status: 'done', digest: 'd1', board, stale: false })
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(useWhiteboardStore.getState().entries[1].status).toBe('done')
    const calls = vi.mocked(getWhiteboard).mock.calls.length
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)
    expect(getWhiteboard).toHaveBeenCalledTimes(calls)
  })

  it('GET 이 error 를 주면 error 로 전이한다', async () => {
    await startRunning()
    vi.mocked(getWhiteboard).mockResolvedValue({ status: 'error', digest: 'd1', error_kind: 'timeout', stale: false })
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(useWhiteboardStore.getState().entries[1].status).toBe('error')
  })

  it('최대 10분 뒤에는 폴링을 멈춘다', async () => {
    await startRunning()
    await vi.advanceTimersByTimeAsync(POLL_MAX_MS + POLL_INTERVAL_MS * 2)
    const calls = vi.mocked(getWhiteboard).mock.calls.length
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 4)
    expect(getWhiteboard).toHaveBeenCalledTimes(calls)
  })

  it('채널 구독이 rejected 되면 unwatch 하고 폴링만으로 완료한다(재구독 없음)', async () => {
    await startRunning()
    expect(channel.creates).toBe(1)
    channel.handlers!.rejected!()
    expect(channel.unsub).toHaveBeenCalled()
    vi.mocked(getWhiteboard).mockResolvedValue({ status: 'done', digest: 'd1', board, stale: false })
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(useWhiteboardStore.getState().entries[1].status).toBe('done')
    expect(channel.creates).toBe(1)
  })

  it('disposeAll 은 구독·폴링을 모두 정리한다', async () => {
    await startRunning()
    useWhiteboardStore.getState().disposeAll()
    expect(channel.unsub).toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)
    expect(getWhiteboard).not.toHaveBeenCalled()
    expect(useWhiteboardStore.getState().entries[1]).toBeUndefined()
  })

  it('reset 도 해당 회의의 구독·폴링을 정리한다', async () => {
    await startRunning()
    useWhiteboardStore.getState().reset(1)
    expect(channel.unsub).toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)
    expect(getWhiteboard).not.toHaveBeenCalled()
  })

  it('로그아웃(인증 해제) 시 정리된다', async () => {
    useAuthStore.setState({ isAuthenticated: true })
    await startRunning()
    useAuthStore.setState({ isAuthenticated: false })
    expect(channel.unsub).toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)
    expect(getWhiteboard).not.toHaveBeenCalled()
  })
})
