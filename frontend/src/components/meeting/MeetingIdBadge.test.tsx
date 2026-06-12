import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MeetingIdBadge } from './MeetingIdBadge'

describe('MeetingIdBadge', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    })
  })

  it('회의 ID를 #형식으로 표시한다', () => {
    render(<MeetingIdBadge meetingId={149} />)
    expect(screen.getByText('#149')).toBeInTheDocument()
  })

  it('클릭 시 ID를 클립보드에 복사하고 피드백을 보여준다', async () => {
    render(<MeetingIdBadge meetingId={149} />)
    fireEvent.click(screen.getByTitle('회의 ID 복사'))

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('149')
      expect(screen.getByText('복사됨')).toBeInTheDocument()
    })
  })
})
