import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ViewerHeader } from './ViewerHeader'

describe('ViewerHeader', () => {
  const defaultProps = {
    title: '주간 회의',
    participantCount: 3,
    isRecordingStopped: false,
    onLeave: vi.fn(),
  }

  it('회의 제목을 표시한다', () => {
    render(<ViewerHeader {...defaultProps} />)
    expect(screen.getByText('주간 회의')).toBeInTheDocument()
  })

  it('"회의 참여 중" 라벨을 표시한다', () => {
    render(<ViewerHeader {...defaultProps} />)
    expect(screen.getByText('회의 참여 중')).toBeInTheDocument()
  })

  it('참여자 수를 배지로 표시한다', () => {
    render(<ViewerHeader {...defaultProps} />)
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('녹음 중일 때 녹음 중 인디케이터를 표시한다', () => {
    render(<ViewerHeader {...defaultProps} isRecordingStopped={false} />)
    expect(screen.getByText('녹음중')).toBeInTheDocument()
  })

  it('녹음 종료 시 "종료됨" 텍스트를 표시한다', () => {
    render(<ViewerHeader {...defaultProps} isRecordingStopped={true} />)
    expect(screen.getByText('종료됨')).toBeInTheDocument()
  })

  it('녹음 종료 시 안내 배너를 표시한다', () => {
    render(<ViewerHeader {...defaultProps} isRecordingStopped={true} />)
    expect(screen.getByText(/회의가 종료되었습니다/)).toBeInTheDocument()
  })

  it('녹음 중일 때 안내 배너를 표시하지 않는다', () => {
    render(<ViewerHeader {...defaultProps} isRecordingStopped={false} />)
    expect(screen.queryByText(/회의가 종료되었습니다/)).not.toBeInTheDocument()
  })

  it('나가기 버튼 클릭 시 onLeave를 호출한다', async () => {
    const user = userEvent.setup()
    const onLeave = vi.fn()
    render(<ViewerHeader {...defaultProps} onLeave={onLeave} />)
    // 텍스트가 있는 나가기 버튼 (우측)
    const buttons = screen.getAllByRole('button', { name: '나가기' })
    await user.click(buttons[buttons.length - 1])
    expect(onLeave).toHaveBeenCalled()
  })
})
