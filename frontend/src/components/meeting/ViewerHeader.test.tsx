import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ViewerHeader } from './ViewerHeader'

describe('ViewerHeader', () => {
  const defaultProps = {
    title: '주간 회의',
    isRecordingStopped: false,
    onBack: vi.fn(),
  }

  it('회의 제목을 표시한다', () => {
    render(<ViewerHeader {...defaultProps} />)
    expect(screen.getByText('주간 회의')).toBeInTheDocument()
  })

  it('"다른 기기에서 녹음 중 — 실시간 보기" 라벨을 표시한다', () => {
    render(<ViewerHeader {...defaultProps} />)
    expect(screen.getByText('다른 기기에서 녹음 중 — 실시간 보기')).toBeInTheDocument()
  })

  it('녹음 중일 때 녹음 중 인디케이터를 표시한다', () => {
    render(<ViewerHeader {...defaultProps} isRecordingStopped={false} />)
    expect(screen.getByText('녹음중')).toBeInTheDocument()
  })

  it('녹음 종료 시 "종료됨" 텍스트를 표시한다', () => {
    render(<ViewerHeader {...defaultProps} isRecordingStopped={true} />)
    expect(screen.getByText('종료됨')).toBeInTheDocument()
  })

  it('일시정지 중이면 "일시정지" 배지를 amber로 표시한다', () => {
    render(<ViewerHeader {...defaultProps} isPaused={true} />)
    const badge = screen.getByText('일시정지')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('bg-amber-100')
    expect(screen.queryByText('녹음중')).not.toBeInTheDocument()
  })

  it('종료됨이 일시정지보다 우선한다', () => {
    render(<ViewerHeader {...defaultProps} isRecordingStopped={true} isPaused={true} />)
    expect(screen.getByText('종료됨')).toBeInTheDocument()
    expect(screen.queryByText('일시정지')).not.toBeInTheDocument()
  })

  it('녹음 종료 시 안내 배너를 표시한다', () => {
    render(<ViewerHeader {...defaultProps} isRecordingStopped={true} />)
    expect(screen.getByText(/회의가 종료되었습니다/)).toBeInTheDocument()
  })

  it('녹음 중일 때 안내 배너를 표시하지 않는다', () => {
    render(<ViewerHeader {...defaultProps} isRecordingStopped={false} />)
    expect(screen.queryByText(/회의가 종료되었습니다/)).not.toBeInTheDocument()
  })

  it('뒤로 버튼 클릭 시 onBack을 호출한다', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    render(<ViewerHeader {...defaultProps} onBack={onBack} />)
    await user.click(screen.getByTitle('뒤로'))
    expect(onBack).toHaveBeenCalled()
  })

  it('참여/나가기 요소를 표시하지 않는다', () => {
    render(<ViewerHeader {...defaultProps} />)
    expect(screen.queryByText('나가기')).not.toBeInTheDocument()
    expect(screen.queryByText('회의 참여 중')).not.toBeInTheDocument()
  })
})
