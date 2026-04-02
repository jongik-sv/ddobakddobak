import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useAuthStore } from '../../stores/authStore'

// ky mock — apiClient 사용하는 함수들이 동작하도록
vi.mock('ky', () => {
  const create = vi.fn(() => ({
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  }))
  return { default: { create }, __esModule: true }
})

describe('meetings API — fetch 호출 JWT 헤더', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    localStorage.clear()
    useAuthStore.setState({
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: false,
    })
    // fetch mock
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ meeting: { id: 1 } }),
    })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('uploadAudio: accessToken이 있으면 Authorization 헤더를 포함한다', async () => {
    useAuthStore.setState({ accessToken: 'jwt-for-upload' })
    const { uploadAudio } = await import('../../api/meetings')

    const blob = new Blob(['test'], { type: 'audio/webm' })
    await uploadAudio(1, blob)

    expect(globalThis.fetch).toHaveBeenCalledOnce()
    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(options.headers).toBeDefined()
    expect(options.headers.Authorization).toBe('Bearer jwt-for-upload')
  })

  it('uploadAudio: accessToken이 없으면 Authorization 헤더를 포함하지 않는다', async () => {
    useAuthStore.setState({ accessToken: null })
    const { uploadAudio } = await import('../../api/meetings')

    const blob = new Blob(['test'], { type: 'audio/webm' })
    await uploadAudio(1, blob)

    expect(globalThis.fetch).toHaveBeenCalledOnce()
    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    // Authorization 헤더가 없거나 빈 객체
    expect(options.headers?.Authorization).toBeUndefined()
  })

  it('uploadAudioFile: accessToken이 있으면 Authorization 헤더를 포함한다', async () => {
    useAuthStore.setState({ accessToken: 'jwt-for-file' })
    const { uploadAudioFile } = await import('../../api/meetings')

    const file = new File(['audio-content'], 'test.wav', { type: 'audio/wav' })
    await uploadAudioFile({ title: 'Test', audio: file })

    expect(globalThis.fetch).toHaveBeenCalledOnce()
    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(options.headers.Authorization).toBe('Bearer jwt-for-file')
  })

  it('uploadAudioFile: accessToken이 없으면 Authorization 헤더를 포함하지 않는다', async () => {
    useAuthStore.setState({ accessToken: null })
    const { uploadAudioFile } = await import('../../api/meetings')

    const file = new File(['audio-content'], 'test.wav', { type: 'audio/wav' })
    await uploadAudioFile({ title: 'Test', audio: file })

    expect(globalThis.fetch).toHaveBeenCalledOnce()
    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(options.headers?.Authorization).toBeUndefined()
  })
})
