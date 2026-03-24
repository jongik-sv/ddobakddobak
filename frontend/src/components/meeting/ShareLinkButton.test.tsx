import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ShareLinkButton } from './ShareLinkButton'

describe('ShareLinkButton', () => {
  const writeTextMock = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      writable: true,
      configurable: true,
    })
    vi.useFakeTimers()
    writeTextMock.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('링크 복사 버튼 렌더링', () => {
    render(<ShareLinkButton meetingId={42} />)
    expect(screen.getByRole('button')).toBeInTheDocument()
    expect(screen.getByText('링크 복사')).toBeInTheDocument()
  })

  it('클릭 시 올바른 URL을 clipboard에 복사', async () => {
    render(<ShareLinkButton meetingId={42} />)
    const button = screen.getByRole('button')
    await act(async () => {
      fireEvent.click(button)
    })
    expect(writeTextMock).toHaveBeenCalledWith(
      expect.stringContaining('/meetings/42')
    )
  })

  it('복사 직후 "복사됨" 텍스트 표시', async () => {
    render(<ShareLinkButton meetingId={42} />)
    const button = screen.getByRole('button')
    await act(async () => {
      fireEvent.click(button)
    })
    expect(screen.getByText('복사됨')).toBeInTheDocument()
  })

  it('2초 후 원래 "링크 복사" 텍스트로 복귀', async () => {
    render(<ShareLinkButton meetingId={42} />)
    const button = screen.getByRole('button')
    await act(async () => {
      fireEvent.click(button)
    })
    expect(screen.getByText('복사됨')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(screen.getByText('링크 복사')).toBeInTheDocument()
  })
})
