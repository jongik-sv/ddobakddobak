import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TimestampBadge } from './TimestampBadge'

describe('TimestampBadge', () => {
  it('shows MM:SS and calls onSeek(ms) on click', () => {
    const onSeek = vi.fn()
    render(<TimestampBadge ms={125000} speaker="화자 1" onSeek={onSeek} />)
    expect(screen.getByText('02:05')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button'))
    expect(onSeek).toHaveBeenCalledWith(125000)
  })
  it('does not call onSeek when audio not ready', () => {
    const onSeek = vi.fn()
    render(<TimestampBadge ms={1000} speaker="화자 1" onSeek={onSeek} isAudioReady={false} />)
    expect(screen.getByRole('button')).toBeDisabled()
    fireEvent.click(screen.getByRole('button'))
    expect(onSeek).not.toHaveBeenCalled()
  })
})
