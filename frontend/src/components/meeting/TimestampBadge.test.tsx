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

  it('meetingId>0이면 button 대신 span으로 렌더되고 클릭해도 onSeek가 호출되지 않는다', () => {
    const onSeek = vi.fn()
    render(<TimestampBadge ms={90000} speaker="화자 1" onSeek={onSeek} meetingId={5} meetingTitle="지난 회의" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    const badge = screen.getByText('01:30')
    fireEvent.click(badge)
    expect(onSeek).not.toHaveBeenCalled()
  })

  it('inert 배지 툴팁은 "이전 회의: <회의명> · <화자> · <시간>" 형식이다', () => {
    render(<TimestampBadge ms={90000} speaker="화자 1" onSeek={vi.fn()} meetingId={5} meetingTitle="지난 회의" />)
    expect(screen.getByTitle('이전 회의: 지난 회의 · 화자 1 · 01:30')).toBeInTheDocument()
  })

  it('meetingId>0인데 meetingTitle이 없으면 "이전 회의:" 접두 없이 폴백한다(중복 방지)', () => {
    render(<TimestampBadge ms={90000} speaker="화자 1" onSeek={vi.fn()} meetingId={5} />)
    expect(screen.getByTitle('이전 회의 · 화자 1 · 01:30')).toBeInTheDocument()
  })
})
