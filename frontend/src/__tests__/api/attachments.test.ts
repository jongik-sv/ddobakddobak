import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useAuthStore } from '../../stores/authStore'

// ky mock
vi.mock('ky', () => {
  const create = vi.fn(() => ({
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  }))
  return { default: { create }, __esModule: true }
})

describe('attachments API — fetch 호출 JWT 헤더', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    localStorage.clear()
    useAuthStore.setState({
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: false,
    })
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ attachment: { id: 1 } }),
    })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('createFileAttachment: accessToken이 있으면 Authorization 헤더를 포함한다', async () => {
    useAuthStore.setState({ accessToken: 'jwt-for-attachment' })
    const { createFileAttachment } = await import('../../api/attachments')

    const file = new File(['file-content'], 'doc.pdf', { type: 'application/pdf' })
    await createFileAttachment(1, 'reference', file)

    expect(globalThis.fetch).toHaveBeenCalledOnce()
    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(options.headers).toBeDefined()
    expect(options.headers.Authorization).toBe('Bearer jwt-for-attachment')
  })

  it('createFileAttachment: accessToken이 없으면 Authorization 헤더를 포함하지 않는다', async () => {
    useAuthStore.setState({ accessToken: null })
    const { createFileAttachment } = await import('../../api/attachments')

    const file = new File(['file-content'], 'doc.pdf', { type: 'application/pdf' })
    await createFileAttachment(1, 'reference', file)

    expect(globalThis.fetch).toHaveBeenCalledOnce()
    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(options.headers?.Authorization).toBeUndefined()
  })

  it('getAttachmentDownloadUrl: 동적으로 API URL을 사용한다', async () => {
    localStorage.setItem('mode', 'server')
    localStorage.setItem('server_url', 'https://api.example.com')
    const { getAttachmentDownloadUrl } = await import('../../api/attachments')

    const url = getAttachmentDownloadUrl(42, 7)
    expect(url).toContain('/meetings/42/attachments/7/download')
    // 동적 URL 사용 확인: getApiBaseUrl()을 매번 호출하므로 서버 URL이 반영됨
    expect(url).toContain('api.example.com')
  })
})
