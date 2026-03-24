import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildMarkdownFilename, downloadMarkdown } from '../markdown'

describe('buildMarkdownFilename', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('meetingId와 날짜 문자열로 올바른 파일명을 반환한다', () => {
    expect(buildMarkdownFilename(42, '2026-03-25T14:00:00Z')).toBe('meeting-42-2026-03-25.md')
  })

  it('Date 객체를 받을 수 있다', () => {
    expect(buildMarkdownFilename(1, new Date('2026-01-01'))).toBe('meeting-1-2026-01-01.md')
  })

  it('날짜 미입력 시 오늘 날짜를 사용한다', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-25T00:00:00Z'))
    expect(buildMarkdownFilename(99)).toBe('meeting-99-2026-03-25.md')
  })
})

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
