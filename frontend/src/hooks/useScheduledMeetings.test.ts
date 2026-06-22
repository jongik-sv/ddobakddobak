import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { ScheduledMeeting } from '../api/meetings/types'

const navigate = vi.fn()
let pathname = '/meetings'

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  useLocation: () => ({ pathname }),
}))

const getScheduledMeetings = vi.fn<() => Promise<ScheduledMeeting[]>>()
vi.mock('../api/meetings', () => ({
  getScheduledMeetings: () => getScheduledMeetings(),
}))

const confirmDialog = vi.fn<() => Promise<boolean>>()
vi.mock('../lib/confirmDialog', () => ({
  confirmDialog: () => confirmDialog(),
}))

// @tauri-apps/plugin-notification: jsdom 환경에서는 실제 플러그인이 없으므로 no-op stub.
// 데스크톱 브랜치(dynamic import)에서 catch-swallow로 처리되지만, 타입 해결을 위해 명시적 mock 필요.
vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: async () => true,
  requestPermission: async () => 'granted',
  sendNotification: () => {},
}))

// 기본은 웹(IS_TAURI=false). auto+데스크톱 케이스는 별도 it에서 doMock으로 덮는다.
vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config')>()),
  IS_TAURI: false,
}))

const NOW = Date.UTC(2026, 5, 21, 10, 0, 0)

function meeting(over: Partial<ScheduledMeeting> & { id: number }): ScheduledMeeting {
  return {
    title: `회의 ${over.id}`,
    status: 'pending',
    meeting_type: 'general',
    created_by: { id: 1, name: 'tester' },
    brief_summary: null,
    folder_id: null,
    audio_duration_ms: 0,
    last_transcript_end_ms: 0,
    last_sequence_number: 0,
    memo: null,
    attendees: null,
    shared: true,
    locked: false,
    locked_at: null,
    important: false,
    started_at: null,
    ended_at: null,
    created_at: new Date(NOW).toISOString(),
    scheduled_start_time: new Date(NOW).toISOString(),
    auto_start_mode: 'manual',
    recurrence_rule: null,
    schedule_dismissed_at: null,
    missed: false,
    ...over,
  }
}

/** poll()의 await 체인이 다 풀릴 때까지 마이크로태스크 큐를 비운다. */
async function flush() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('useScheduledMeetings', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    pathname = '/meetings'
    navigate.mockReset()
    getScheduledMeetings.mockReset()
    confirmDialog.mockReset()
    getScheduledMeetings.mockResolvedValue([])
    confirmDialog.mockResolvedValue(true)
  })
  afterEach(() => vi.useRealTimers())

  it('마운트 시 1회 폴링한다', async () => {
    const { useScheduledMeetings } = await import('./useScheduledMeetings')
    renderHook(() => useScheduledMeetings())
    await flush()
    expect(getScheduledMeetings).toHaveBeenCalledTimes(1)
  })

  it('30초마다 폴링한다', async () => {
    const { useScheduledMeetings } = await import('./useScheduledMeetings')
    renderHook(() => useScheduledMeetings())
    await flush()
    await vi.advanceTimersByTimeAsync(30_000)
    await flush()
    expect(getScheduledMeetings).toHaveBeenCalledTimes(2)
  })

  it('manual 트리거: confirm Yes면 autoStart state로 네비게이트', async () => {
    getScheduledMeetings.mockResolvedValue([meeting({ id: 5, auto_start_mode: 'manual' })])
    confirmDialog.mockResolvedValue(true)
    const { useScheduledMeetings } = await import('./useScheduledMeetings')
    renderHook(() => useScheduledMeetings())
    await flush()
    expect(confirmDialog).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith('/meetings/5/live', { state: { autoStart: true } })
  })

  it('manual 트리거: confirm No면 네비게이트하지 않는다', async () => {
    getScheduledMeetings.mockResolvedValue([meeting({ id: 5, auto_start_mode: 'manual' })])
    confirmDialog.mockResolvedValue(false)
    const { useScheduledMeetings } = await import('./useScheduledMeetings')
    renderHook(() => useScheduledMeetings())
    await flush()
    expect(confirmDialog).toHaveBeenCalledTimes(1)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('한 번 트리거한 회의는 다음 폴에서 재트리거하지 않는다(dedup)', async () => {
    getScheduledMeetings.mockResolvedValue([meeting({ id: 5, auto_start_mode: 'manual' })])
    confirmDialog.mockResolvedValue(true)
    const { useScheduledMeetings } = await import('./useScheduledMeetings')
    renderHook(() => useScheduledMeetings())
    await flush()
    await vi.advanceTimersByTimeAsync(30_000)
    await flush()
    expect(confirmDialog).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('/live 페이지에서는 트리거하지 않는다', async () => {
    pathname = '/meetings/5/live'
    getScheduledMeetings.mockResolvedValue([meeting({ id: 5, auto_start_mode: 'manual' })])
    const { useScheduledMeetings } = await import('./useScheduledMeetings')
    renderHook(() => useScheduledMeetings())
    await flush()
    expect(confirmDialog).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('웹 auto 모드도 confirm으로 강등(제스처 필요)', async () => {
    getScheduledMeetings.mockResolvedValue([meeting({ id: 9, auto_start_mode: 'auto' })])
    confirmDialog.mockResolvedValue(true)
    const { useScheduledMeetings } = await import('./useScheduledMeetings')
    renderHook(() => useScheduledMeetings())
    await flush()
    expect(confirmDialog).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith('/meetings/9/live', { state: { autoStart: true } })
  })

  it('폴링 실패는 조용히 무시한다', async () => {
    getScheduledMeetings.mockRejectedValue(new Error('offline'))
    const { useScheduledMeetings } = await import('./useScheduledMeetings')
    expect(() => renderHook(() => useScheduledMeetings())).not.toThrow()
    await flush()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('언마운트 시 인터벌을 정리한다(폴링 중단)', async () => {
    getScheduledMeetings.mockResolvedValue([])
    const { useScheduledMeetings } = await import('./useScheduledMeetings')
    const { unmount } = renderHook(() => useScheduledMeetings())
    await flush()
    expect(getScheduledMeetings).toHaveBeenCalledTimes(1)
    unmount()
    await vi.advanceTimersByTimeAsync(60_000)
    await flush()
    expect(getScheduledMeetings).toHaveBeenCalledTimes(1)
  })
})

describe('useScheduledMeetings (데스크톱)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    pathname = '/meetings'
    navigate.mockReset()
    getScheduledMeetings.mockReset()
    confirmDialog.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.resetModules()
  })

  it('auto 모드 + 데스크톱(Tauri)은 confirm 없이 자동 네비게이트', async () => {
    vi.doMock('../config', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../config')>()),
      IS_TAURI: true,
    }))
    getScheduledMeetings.mockResolvedValue([meeting({ id: 3, auto_start_mode: 'auto' })])
    const { useScheduledMeetings } = await import('./useScheduledMeetings')
    renderHook(() => useScheduledMeetings())
    await flush()
    expect(confirmDialog).not.toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith('/meetings/3/live', { state: { autoStart: true } })
  })

  it('desktop(local): 폴하지 않고 트리거 이벤트로 goLive 한다 (auto)', async () => {
    confirmDialog.mockResolvedValue(true)
    const listeners: Record<string, (e: { payload: unknown }) => void> = {}
    vi.doMock('@tauri-apps/api/event', () => ({
      listen: (name: string, cb: (e: { payload: unknown }) => void) => {
        listeners[name] = cb
        return Promise.resolve(() => { delete listeners[name] })
      },
    }))
    vi.doMock('../config', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../config')>()),
      IS_TAURI: true,
      getMode: () => 'local',
    }))
    const { useScheduledMeetings } = await import('./useScheduledMeetings')
    // act + runAllTicks로 동적 import('@tauri-apps/api/event') → listen 등록까지 보장
    await act(async () => {
      renderHook(() => useScheduledMeetings())
      await vi.runAllTicks()
    })
    expect(getScheduledMeetings).not.toHaveBeenCalled() // desktop은 JS 폴 안 함
    expect(listeners['scheduled-meeting-trigger']).toBeDefined()
    await act(async () => {
      listeners['scheduled-meeting-trigger']?.({ payload: { meetingId: 7, mode: 'auto' } })
      await flush()
    })
    // auto → confirmDialog 호출하지 않고 즉시 navigate
    expect(confirmDialog).not.toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith('/meetings/7/live', { state: { autoStart: true } })
  })

  it('desktop(local): manual + 승인 → navigate 한다', async () => {
    confirmDialog.mockResolvedValue(true)
    const listeners: Record<string, (e: { payload: unknown }) => void> = {}
    vi.doMock('@tauri-apps/api/event', () => ({
      listen: (name: string, cb: (e: { payload: unknown }) => void) => {
        listeners[name] = cb
        return Promise.resolve(() => { delete listeners[name] })
      },
    }))
    vi.doMock('../config', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../config')>()),
      IS_TAURI: true,
      getMode: () => 'local',
    }))
    const { useScheduledMeetings } = await import('./useScheduledMeetings')
    await act(async () => {
      renderHook(() => useScheduledMeetings())
      await vi.runAllTicks()
    })
    await act(async () => {
      listeners['scheduled-meeting-trigger']?.({ payload: { meetingId: 8, mode: 'manual' } })
      await flush()
    })
    expect(confirmDialog).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith('/meetings/8/live', { state: { autoStart: true } })
  })

  it('desktop(local): manual + 거절 → navigate 하지 않는다', async () => {
    confirmDialog.mockResolvedValue(false)
    const listeners: Record<string, (e: { payload: unknown }) => void> = {}
    vi.doMock('@tauri-apps/api/event', () => ({
      listen: (name: string, cb: (e: { payload: unknown }) => void) => {
        listeners[name] = cb
        return Promise.resolve(() => { delete listeners[name] })
      },
    }))
    vi.doMock('../config', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../config')>()),
      IS_TAURI: true,
      getMode: () => 'local',
    }))
    const { useScheduledMeetings } = await import('./useScheduledMeetings')
    await act(async () => {
      renderHook(() => useScheduledMeetings())
      await vi.runAllTicks()
    })
    await act(async () => {
      listeners['scheduled-meeting-trigger']?.({ payload: { meetingId: 8, mode: 'manual' } })
      await flush()
    })
    expect(confirmDialog).toHaveBeenCalledTimes(1)
    expect(navigate).not.toHaveBeenCalled()
  })
})
