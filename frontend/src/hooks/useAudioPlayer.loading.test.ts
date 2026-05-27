import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

// 서버 모드 강제 (fetch → blob 경로)
vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config')>()),
  getMode: () => 'server',
  getApiBaseUrl: () => 'http://test.local',
}))

// peaks가 isReady를 풀지 못하도록 duration 없는 응답
vi.mock('../api/client', () => ({
  apiClient: {
    get: vi.fn().mockReturnValue({
      json: vi.fn().mockResolvedValue({}),
      blob: vi.fn(),
      headers: { get: vi.fn() },
    }),
  },
  getAuthHeaders: vi.fn(() => ({})),
}))

vi.mock('../lib/download', () => ({ downloadBlob: vi.fn() }))

import { useAudioPlayer } from './useAudioPlayer'

describe('useAudioPlayer 로딩 상태(서버 모드)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('오디오 fetch가 404여도 isReady=true, hasAudio=false로 풀린다(무한 로딩 방지)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))

    const { result } = renderHook(() => useAudioPlayer(1))

    await waitFor(() => expect(result.current.isReady).toBe(true))
    expect(result.current.hasAudio).toBe(false)
  })

  it('오디오 응답이 빈 blob이면 isReady=true, hasAudio=false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(new Blob([], { type: 'audio/mpeg' })),
      }),
    )

    const { result } = renderHook(() => useAudioPlayer(2))

    await waitFor(() => expect(result.current.isReady).toBe(true))
    expect(result.current.hasAudio).toBe(false)
  })
})
