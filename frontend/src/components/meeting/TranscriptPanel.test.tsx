import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TranscriptPanel } from './TranscriptPanel'

const mockTranscripts = [
  {
    id: 1,
    speaker_label: 'SPEAKER_00',
    content: '첫 번째 발화입니다.',
    started_at_ms: 0,
    ended_at_ms: 3000,
    sequence_number: 1,
  },
  {
    id: 2,
    speaker_label: 'SPEAKER_01',
    content: '두 번째 발화입니다.',
    started_at_ms: 3000,
    ended_at_ms: 6000,
    sequence_number: 2,
  },
  {
    id: 3,
    speaker_label: 'SPEAKER_00',
    content: '세 번째 발화입니다.',
    started_at_ms: 6000,
    ended_at_ms: 9000,
    sequence_number: 3,
  },
]

describe('TranscriptPanel', () => {
  it('트랜스크립트 목록을 렌더링한다', () => {
    render(
      <TranscriptPanel
        transcripts={mockTranscripts}
        currentTimeMs={0}
        onSeek={vi.fn()}
      />
    )

    expect(screen.getByText('첫 번째 발화입니다.')).toBeInTheDocument()
    expect(screen.getByText('두 번째 발화입니다.')).toBeInTheDocument()
    expect(screen.getByText('세 번째 발화입니다.')).toBeInTheDocument()
  })

  it('화자 레이블을 표시한다', () => {
    render(
      <TranscriptPanel
        transcripts={mockTranscripts}
        currentTimeMs={0}
        onSeek={vi.fn()}
      />
    )

    expect(screen.getAllByText('SPEAKER_00').length).toBeGreaterThan(0)
    expect(screen.getByText('SPEAKER_01')).toBeInTheDocument()
  })

  it('currentTimeMs가 started_at_ms~ended_at_ms 범위인 세그먼트를 하이라이트한다', () => {
    render(
      <TranscriptPanel
        transcripts={mockTranscripts}
        currentTimeMs={1500}
        onSeek={vi.fn()}
      />
    )

    const highlighted = screen.getByText('첫 번째 발화입니다.').closest('[data-highlighted="true"]')
    expect(highlighted).toBeInTheDocument()
  })

  it('currentTimeMs 범위 밖의 세그먼트는 하이라이트되지 않는다', () => {
    render(
      <TranscriptPanel
        transcripts={mockTranscripts}
        currentTimeMs={1500}
        onSeek={vi.fn()}
      />
    )

    const notHighlighted = screen.getByText('두 번째 발화입니다.').closest('[data-highlighted]')
    expect(notHighlighted?.getAttribute('data-highlighted')).toBe('false')
  })

  it('세그먼트 클릭 시 onSeek(started_at_ms) 호출한다', () => {
    const onSeek = vi.fn()
    render(
      <TranscriptPanel
        transcripts={mockTranscripts}
        currentTimeMs={0}
        onSeek={onSeek}
      />
    )

    fireEvent.click(screen.getByText('두 번째 발화입니다.'))
    expect(onSeek).toHaveBeenCalledWith(3000)
  })

  it('빈 트랜스크립트 배열에서도 렌더링된다', () => {
    const { container } = render(
      <TranscriptPanel
        transcripts={[]}
        currentTimeMs={0}
        onSeek={vi.fn()}
      />
    )

    expect(container.firstChild).toBeInTheDocument()
  })

  it('트랜스크립트가 없을 때 빈 상태 메시지를 표시한다', () => {
    render(
      <TranscriptPanel
        transcripts={[]}
        currentTimeMs={0}
        onSeek={vi.fn()}
      />
    )

    expect(screen.getByText(/트랜스크립트가 없습니다/)).toBeInTheDocument()
  })
})
