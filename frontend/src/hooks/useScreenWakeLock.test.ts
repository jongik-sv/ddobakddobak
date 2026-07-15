import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { useScreenWakeLock } from './useScreenWakeLock'

type ReleaseListener = () => void

/** release 이벤트를 지원하는 WakeLockSentinel mock. */
function createMockSentinel() {
  const listeners = new Set<ReleaseListener>()
  const sentinel = {
    addEventListener: vi.fn((type: string, cb: ReleaseListener) => {
      if (type === 'release') listeners.add(cb)
    }),
    removeEventListener: vi.fn((type: string, cb: ReleaseListener) => {
      if (type === 'release') listeners.delete(cb)
    }),
    release: vi.fn(() => {
      listeners.forEach((cb) => cb())
      return Promise.resolve()
    }),
    /** 브라우저 임의 해제(탭 hidden 등) 시뮬레이션 — release() 호출 없이 이벤트만 발화. */
    fireRelease() {
      listeners.forEach((cb) => cb())
    },
  }
  return sentinel
}

type MockSentinel = ReturnType<typeof createMockSentinel>

/**
 * navigator.wakeLock mock 설치 (setup.ts의 matchMedia 패턴).
 * jsdom navigator에는 wakeLock이 없으므로 afterEach에서 delete로 원복한다.
 */
function installWakeLock(requestImpl?: () => Promise<unknown>) {
  const sentinels: MockSentinel[] = []
  const request = vi.fn(
    requestImpl ??
      (() => {
        const s = createMockSentinel()
        sentinels.push(s)
        return Promise.resolve(s)
      }),
  )
  Object.defineProperty(navigator, 'wakeLock', {
    value: { request },
    configurable: true,
  })
  return { request, sentinels }
}

/** document.visibilityState 오버라이드 (afterEach에서 delete로 jsdom 기본 getter 원복). */
function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
}

/** 마이크로태스크 flush — request Promise resolve를 effect 밖에서 기다린다. */
const flush = () => act(async () => {})

describe('useScreenWakeLock', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'wakeLock')
    Reflect.deleteProperty(document, 'visibilityState')
    vi.restoreAllMocks()
  })

  it('active=true → request("screen") 1회 획득', async () => {
    const { request } = installWakeLock()
    renderHook(() => useScreenWakeLock(true))
    await flush()

    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith('screen')
  })

  it('active=false → request 0회 (idle/시청자 컨텍스트에서 lock 없음)', async () => {
    const { request } = installWakeLock()
    renderHook(() => useScreenWakeLock(false))
    await flush()

    expect(request).not.toHaveBeenCalled()
  })

  it('active true→false 전환 → sentinel.release 호출 (녹음 종료 시 lock 반납)', async () => {
    const { sentinels } = installWakeLock()
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) => useScreenWakeLock(active),
      { initialProps: { active: true } },
    )
    await flush()
    expect(sentinels).toHaveLength(1)

    rerender({ active: false })
    expect(sentinels[0].release).toHaveBeenCalledTimes(1)
  })

  it('hidden에서 브라우저 임의 해제 → visible 복귀 시 재획득 (hidden 중에는 재요청 금지)', async () => {
    const { request, sentinels } = installWakeLock()
    renderHook(() => useScreenWakeLock(true))
    await flush()
    expect(request).toHaveBeenCalledTimes(1)

    // 탭 hidden: 브라우저가 lock을 자동 해제 (release 이벤트만 발화)
    setVisibility('hidden')
    sentinels[0].fireRelease()
    document.dispatchEvent(new Event('visibilitychange'))
    await flush()
    expect(request).toHaveBeenCalledTimes(1) // hidden 상태에서는 NotAllowedError라 시도 안 함

    // visible 복귀 → 재획득
    setVisibility('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    await flush()
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('request pending 중 visibilitychange 연타 → 중복 request 없이 최종 sentinel 1개만 유지', async () => {
    // resolve를 수동 제어해 첫 요청을 pending 상태로 붙잡아 둔다
    const resolvers: Array<(s: MockSentinel) => void> = []
    const { request } = installWakeLock(
      () => new Promise((res) => { resolvers.push(res as (s: MockSentinel) => void) }),
    )
    setVisibility('visible')
    renderHook(() => useScreenWakeLock(true))
    expect(request).toHaveBeenCalledTimes(1)

    // 첫 요청이 아직 pending인 상태에서 visible 이벤트 연타 (in-flight 가드 경로)
    document.dispatchEvent(new Event('visibilitychange'))
    document.dispatchEvent(new Event('visibilitychange'))
    await flush()
    expect(request).toHaveBeenCalledTimes(1) // pending 중에는 새 request 발사 없음

    // pending 해소 → 큐에 쌓인 재평가들이 돌아도 이미 sentinel 보유라 추가 요청 없음
    const first = createMockSentinel()
    await act(async () => {
      resolvers.forEach((res) => res(first))
    })

    expect(request).toHaveBeenCalledTimes(1)
    expect(first.release).not.toHaveBeenCalled() // 획득분이 중복 취급으로 해제되지 않음
  })

  it('visible 상태에서 UA 임의 해제(배터리 세이버 등) → 즉시 재획득', async () => {
    const { request, sentinels } = installWakeLock()
    setVisibility('visible')
    renderHook(() => useScreenWakeLock(true))
    await flush()
    expect(request).toHaveBeenCalledTimes(1)

    // visible인 채로 브라우저가 lock만 임의 해제 — visibilitychange 이벤트는 오지 않음
    sentinels[0].fireRelease()
    await flush()

    expect(request).toHaveBeenCalledTimes(2)
    expect(sentinels).toHaveLength(2) // 새 sentinel 재획득
    expect(sentinels[1].release).not.toHaveBeenCalled()
  })

  it('active=false 전환의 자체 release로는 재획득 없음 (release→재획득 루프 방지)', async () => {
    const { request, sentinels } = installWakeLock()
    setVisibility('visible')
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) => useScreenWakeLock(active),
      { initialProps: { active: true } },
    )
    await flush()

    // cleanup의 release()도 release 이벤트를 발화시키지만 cancelled 선행 확인으로 재획득 금지
    rerender({ active: false })
    await flush()

    expect(sentinels[0].release).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledTimes(1) // 재획득 시도 없음
  })

  it('navigator.wakeLock 미지원 → 완전 no-op (throw 없음, 리스너 등록 없음)', async () => {
    // jsdom 기본: navigator에 wakeLock 없음
    expect('wakeLock' in navigator).toBe(false)
    const addSpy = vi.spyOn(document, 'addEventListener')

    const { unmount } = renderHook(() => useScreenWakeLock(true))
    await flush()
    unmount()

    expect(addSpy).not.toHaveBeenCalledWith('visibilitychange', expect.any(Function))
  })

  it('request 거부(NotAllowedError) → 에러 미전파, warn만 (녹음은 계속)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    installWakeLock(() => Promise.reject(new Error('NotAllowedError: 배터리 절약 모드')))

    expect(() => renderHook(() => useScreenWakeLock(true))).not.toThrow()
    await flush()

    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it('언마운트 → release + visibilitychange 리스너 해제 (이후 재획득 없음)', async () => {
    const { request, sentinels } = installWakeLock()
    const { unmount } = renderHook(() => useScreenWakeLock(true))
    await flush()

    unmount()
    expect(sentinels[0].release).toHaveBeenCalledTimes(1)

    // 리스너가 해제됐다면 visible 이벤트가 와도 재요청 없음
    document.dispatchEvent(new Event('visibilitychange'))
    await flush()
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('획득 완료 전 언마운트 → 뒤늦게 도착한 sentinel 즉시 해제 (lock 누수 방지)', async () => {
    let resolveRequest!: (s: MockSentinel) => void
    installWakeLock(() => new Promise((res) => { resolveRequest = res }))
    const { unmount } = renderHook(() => useScreenWakeLock(true))

    unmount() // request가 아직 pending인 상태에서 언마운트
    const late = createMockSentinel()
    await act(async () => {
      resolveRequest(late)
    })

    expect(late.release).toHaveBeenCalledTimes(1)
  })
})
