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
})
