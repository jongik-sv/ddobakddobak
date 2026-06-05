import { describe, it, expect, vi, beforeEach } from 'vitest'

// apiClient(ky) mock — createFileAttachment은 raw fetch 대신 apiClient.post(...).json()을 쓴다
// (FormData multipart 보존 + 401 자동 refresh). Authorization 헤더는 apiClient의 beforeRequest
// 훅 책임이라 client 테스트에서 검증하고, 여기선 업로드 페이로드/반환만 검증한다.
const { post } = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('ky', () => {
  const instance = { get: vi.fn(), post, patch: vi.fn(), delete: vi.fn() }
  return { default: { create: vi.fn(() => instance) }, __esModule: true }
})

describe('attachments API', () => {
  beforeEach(() => {
    post.mockReset()
    post.mockReturnValue({ json: () => Promise.resolve({ attachment: { id: 1 } }) })
  })

  it('createFileAttachment: apiClient.post로 FormData(category+file)를 업로드하고 attachment를 반환한다', async () => {
    const { createFileAttachment } = await import('../../api/attachments')
    const file = new File(['file-content'], 'doc.pdf', { type: 'application/pdf' })
    const result = await createFileAttachment(1, 'reference', file)

    expect(post).toHaveBeenCalledOnce()
    const [path, opts] = post.mock.calls[0] as [string, { body: FormData }]
    expect(path).toBe('meetings/1/attachments')
    expect(opts.body).toBeInstanceOf(FormData)
    expect(opts.body.get('category')).toBe('reference')
    expect(opts.body.get('file')).toBeInstanceOf(File)
    expect(result).toEqual({ id: 1 })
  })

  it('getAttachmentDownloadUrl: 동적으로 API URL을 사용한다', async () => {
    const { getAttachmentDownloadUrl } = await import('../../api/attachments')

    const url = getAttachmentDownloadUrl(42, 7)
    expect(url).toContain('/meetings/42/attachments/7/download')
    // 웹(server 모드)은 동일 origin을 사용하므로 getApiBaseUrl()이 페이지 origin을 반영한다.
    expect(url).toContain(window.location.origin)
  })
})
