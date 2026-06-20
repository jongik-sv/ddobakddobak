import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChatMarkdown } from './ChatMarkdown'

describe('ChatMarkdown citation', () => {
  it('renders marker as a clickable badge that seeks', () => {
    const onSeek = vi.fn()
    render(<ChatMarkdown content={'일정 확정. ⟦t:125000|s:화자 1⟧'} onSeek={onSeek} />)
    const badge = screen.getByText('02:05')
    fireEvent.click(badge.closest('button')!)
    expect(onSeek).toHaveBeenCalledWith(125000)
  })

  it('mm:ss 마커를 ms로 변환해 onSeek 호출한다', () => {
    const onSeek = vi.fn()
    render(<ChatMarkdown content={'일정 확정. ⟦t:30:47/s:화자 1⟧'} onSeek={onSeek} />)
    const badge = screen.getByText('30:47')
    fireEvent.click(badge.closest('button')!)
    expect(onSeek).toHaveBeenCalledWith(1847000)
  })

  it('회의ID 마커는 onSeekMeeting으로 라우팅되는 배지를 만든다', () => {
    const onSeekMeeting = vi.fn()
    render(<ChatMarkdown content={'결정. ⟦m:142/t:5000/s:화자 1⟧'} onSeekMeeting={onSeekMeeting} />)
    const badge = screen.getByRole('button')
    fireEvent.click(badge)
    expect(onSeekMeeting).toHaveBeenCalledWith(142, 5000)
  })
})
