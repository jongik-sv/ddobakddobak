import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBadge } from './MeetingListUI'

describe('StatusBadge 일시정지 표시', () => {
  it('recording + paused=true면 "일시정지" 배지를 amber로 표시한다 (pulse 없음)', () => {
    render(<StatusBadge status="recording" paused={true} />)
    const badge = screen.getByText('일시정지')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('bg-amber-100')
    expect(badge.className).toContain('text-amber-700')
    // 녹음중 배지와 달리 점에 pulse 애니메이션이 없어야 한다
    expect(badge.querySelector('.animate-pulse')).toBeNull()
  })

  it('recording + paused 미지정이면 기존 "녹음중" 배지를 유지한다', () => {
    render(<StatusBadge status="recording" />)
    const badge = screen.getByText('녹음중')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('bg-red-100')
    expect(badge.querySelector('.animate-pulse')).not.toBeNull()
  })

  it('recording이 아니면 paused=true여도 일시정지 배지를 표시하지 않는다', () => {
    render(<StatusBadge status="completed" paused={true} />)
    expect(screen.queryByText('일시정지')).not.toBeInTheDocument()
    expect(screen.getByText('완료')).toBeInTheDocument()
  })

  it('pending + scheduled는 기존 예약중 배지를 유지한다 (회귀 가드)', () => {
    render(<StatusBadge status="pending" scheduled={true} />)
    expect(screen.getByText('예약중')).toBeInTheDocument()
  })
})

describe('StatusBadge 요약중 표시', () => {
  it('summarizing=true면 "요약중" 파란 배지를 pulse 점과 함께 표시한다', () => {
    render(<StatusBadge status="completed" summarizing={true} />)
    const badge = screen.getByText('요약중')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('bg-blue-100')
    expect(badge.className).toContain('text-blue-700')
    expect(badge.querySelector('.animate-pulse')).not.toBeNull()
  })

  it('summarizing=true여도 기존 status 배지는 함께 표시한다 (보조 상태)', () => {
    // completed + 요약중(재생성) 이 가장 흔한 케이스 — 완료 배지와 요약중 배지가 겹침.
    render(<StatusBadge status="completed" summarizing={true} />)
    expect(screen.getByText('완료')).toBeInTheDocument()
    expect(screen.getByText('요약중')).toBeInTheDocument()
  })

  it('summarizing 미지정이면 요약중 배지를 표시하지 않는다 (회귀 가드)', () => {
    render(<StatusBadge status="completed" />)
    expect(screen.queryByText('요약중')).not.toBeInTheDocument()
    expect(screen.getByText('완료')).toBeInTheDocument()
  })
})
