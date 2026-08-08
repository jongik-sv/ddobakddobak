import { describe, it, expect, vi, afterEach } from 'vitest'
import { downloadMarkdown } from '../markdown'

describe('downloadMarkdown', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('URL.createObjectURL을 호출하고 anchor click을 실행한다', () => {
    const mockUrl = 'blob:mock-url'
    const createObjectURLMock = vi.fn(() => mockUrl)
    const revokeObjectURLMock = vi.fn()

    vi.stubGlobal('URL', {
      createObjectURL: createObjectURLMock,
      revokeObjectURL: revokeObjectURLMock,
    })

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    downloadMarkdown('# Hello', 'test.md')

    expect(createObjectURLMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'text/markdown;charset=utf-8' })
    )
    expect(clickSpy).toHaveBeenCalled()
    expect(revokeObjectURLMock).toHaveBeenCalledWith(mockUrl)
  })
})
