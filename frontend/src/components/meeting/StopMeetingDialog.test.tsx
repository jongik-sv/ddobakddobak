import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StopMeetingDialog } from './StopMeetingDialog'

describe('StopMeetingDialog', () => {
  it('calls onSummarize when "요약하고 종료" clicked', () => {
    const onSummarize = vi.fn()
    const onSkip = vi.fn()
    const onCancel = vi.fn()
    render(<StopMeetingDialog onSummarize={onSummarize} onSkip={onSkip} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: '요약하고 종료' }))
    expect(onSummarize).toHaveBeenCalledOnce()
    expect(onSkip).not.toHaveBeenCalled()
  })

  it('calls onSkip when "요약 없이 종료" clicked', () => {
    const onSummarize = vi.fn()
    const onSkip = vi.fn()
    const onCancel = vi.fn()
    render(<StopMeetingDialog onSummarize={onSummarize} onSkip={onSkip} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: '요약 없이 종료' }))
    expect(onSkip).toHaveBeenCalledOnce()
  })

  it('calls onCancel when "취소" clicked', () => {
    const onCancel = vi.fn()
    render(<StopMeetingDialog onSummarize={vi.fn()} onSkip={vi.fn()} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
