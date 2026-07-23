import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { TranscriptPanel } from './TranscriptPanel'
import { useTranscriptStore } from '../../stores/transcriptStore'

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
        meetingId={1}
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
        meetingId={1}
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
        meetingId={1}
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
        meetingId={1}
        transcripts={mockTranscripts}
        currentTimeMs={1500}
        onSeek={vi.fn()}
      />
    )

    const notHighlighted = screen.getByText('두 번째 발화입니다.').closest('[data-highlighted]')
    expect(notHighlighted?.getAttribute('data-highlighted')).toBe('false')
  })

  it('시간태그 seek ms가 무음 갭에 떨어져도 가장 가까운 세그먼트를 하이라이트한다', () => {
    // 시간태그 클릭으로 오디오는 seek되는데(currentTimeMs=4000, [3000,6000) 밖은 아님)
    // 회의록 마커가 절삭/근사되어 어떤 구간에도 안 들어가는 케이스 재현.
    const gapped = [
      { id: 1, speaker_label: 'SPEAKER_00', content: '첫 번째 발화입니다.', started_at_ms: 0, ended_at_ms: 3000, sequence_number: 1 },
      { id: 2, speaker_label: 'SPEAKER_01', content: '두 번째 발화입니다.', started_at_ms: 5000, ended_at_ms: 8000, sequence_number: 2 },
    ]
    render(
      <TranscriptPanel meetingId={1} transcripts={gapped} currentTimeMs={4000} onSeek={vi.fn()} />
    )
    const highlighted = screen.getByText('두 번째 발화입니다.').closest('[data-highlighted="true"]')
    expect(highlighted).toBeInTheDocument()
  })

  it('첫 발화 이전(>0) seek이면 첫 세그먼트를 하이라이트한다', () => {
    const later = [
      { id: 1, speaker_label: 'SPEAKER_00', content: '늦게 시작하는 발화.', started_at_ms: 2000, ended_at_ms: 4000, sequence_number: 1 },
    ]
    render(
      <TranscriptPanel meetingId={1} transcripts={later} currentTimeMs={500} onSeek={vi.fn()} />
    )
    const highlighted = screen.getByText('늦게 시작하는 발화.').closest('[data-highlighted="true"]')
    expect(highlighted).toBeInTheDocument()
  })

  it('세그먼트 클릭 시 onSeek(started_at_ms) 호출한다', () => {
    const onSeek = vi.fn()
    render(
      <TranscriptPanel
        meetingId={1}
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
        meetingId={1}
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
        meetingId={1}
        transcripts={[]}
        currentTimeMs={0}
        onSeek={vi.fn()}
      />
    )

    expect(screen.getByText(/트랜스크립트가 없습니다/)).toBeInTheDocument()
  })
})

describe('TranscriptPanel seekTick (#43 — 마커 seek 후 스크롤 추적)', () => {
  it('suppressAutoScroll=true여도 seekTick이 증가하면(명시적 seek) 강제로 스크롤한다', () => {
    const scrollSpy = vi.spyOn(window.HTMLElement.prototype, 'scrollIntoView')
    // currentTimeMs는 그대로 두어(highlightedIndex 불변) "동일 세그먼트로 재-seek" 케이스를 재현.
    const { rerender } = render(
      <TranscriptPanel
        meetingId={1}
        transcripts={mockTranscripts}
        currentTimeMs={1500}
        onSeek={vi.fn()}
        suppressAutoScroll
        seekTick={1}
      />
    )
    scrollSpy.mockClear()

    rerender(
      <TranscriptPanel
        meetingId={1}
        transcripts={mockTranscripts}
        currentTimeMs={1500}
        onSeek={vi.fn()}
        suppressAutoScroll
        seekTick={2}
      />
    )
    expect(scrollSpy).toHaveBeenCalled()
    scrollSpy.mockRestore()
  })

  it('suppressAutoScroll=true이고 seekTick이 안 바뀌면(자동 재생 진행) 스크롤을 억제한다', () => {
    const scrollSpy = vi.spyOn(window.HTMLElement.prototype, 'scrollIntoView')
    const { rerender } = render(
      <TranscriptPanel
        meetingId={1}
        transcripts={mockTranscripts}
        currentTimeMs={0}
        onSeek={vi.fn()}
        suppressAutoScroll
        seekTick={1}
      />
    )
    scrollSpy.mockClear()

    // highlightedIndex는 바뀌지만(0→1) seekTick은 그대로 — 검색 중 오디오가 흘러간 케이스.
    rerender(
      <TranscriptPanel
        meetingId={1}
        transcripts={mockTranscripts}
        currentTimeMs={4000}
        onSeek={vi.fn()}
        suppressAutoScroll
        seekTick={1}
      />
    )
    expect(scrollSpy).not.toHaveBeenCalled()
    scrollSpy.mockRestore()
  })

  it('suppressAutoScroll이 없으면(기본) seekTick 무관하게 highlightedIndex 변화로 스크롤한다 (기존 동작 유지)', () => {
    const scrollSpy = vi.spyOn(window.HTMLElement.prototype, 'scrollIntoView')
    const { rerender } = render(
      <TranscriptPanel
        meetingId={1}
        transcripts={mockTranscripts}
        currentTimeMs={0}
        onSeek={vi.fn()}
      />
    )
    scrollSpy.mockClear()

    rerender(
      <TranscriptPanel
        meetingId={1}
        transcripts={mockTranscripts}
        currentTimeMs={4000}
        onSeek={vi.fn()}
      />
    )
    expect(scrollSpy).toHaveBeenCalled()
    scrollSpy.mockRestore()
  })
})

describe('TranscriptPanel speaker_name', () => {
  beforeEach(() => {
    useTranscriptStore.getState().reset()
  })

  afterEach(() => {
    useTranscriptStore.getState().reset()
  })

  it('speaker_name이 있으면 배지에 이름 표시', () => {
    render(
      <TranscriptPanel
        meetingId={1}
        transcripts={[{ ...mockTranscripts[0], speaker_name: '앨리스' }]}
        currentTimeMs={0}
        onSeek={vi.fn()}
      />
    )

    expect(screen.getByText('앨리스')).toBeInTheDocument()
    expect(screen.queryByText('SPEAKER_00')).not.toBeInTheDocument()
  })

  it('rename 후 store setSpeakerName 호출 시 배지가 즉시 갱신된다', () => {
    useTranscriptStore.getState().loadFinals([
      {
        id: 1,
        content: '첫 번째 발화입니다.',
        speaker_label: 'SPEAKER_00',
        started_at_ms: 0,
        ended_at_ms: 3000,
        sequence_number: 1,
        applied: false,
      },
    ])

    render(
      <TranscriptPanel
        meetingId={1}
        transcripts={[mockTranscripts[0]]}
        currentTimeMs={0}
        onSeek={vi.fn()}
      />
    )
    expect(screen.getByText('SPEAKER_00')).toBeInTheDocument()

    act(() => {
      useTranscriptStore.getState().setSpeakerName('SPEAKER_00', '앨리스')
    })

    expect(screen.getByText('앨리스')).toBeInTheDocument()
    expect(screen.queryByText('SPEAKER_00')).not.toBeInTheDocument()
  })
})
