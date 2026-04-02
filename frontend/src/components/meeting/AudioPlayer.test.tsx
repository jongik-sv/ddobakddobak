import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// useAudioPlayer 훅을 mock
const mockPlay = vi.fn()
const mockPause = vi.fn()
const mockSeekTo = vi.fn()
const mockSetPlaybackRate = vi.fn()
const mockDownload = vi.fn()

const mockAudioPlayerState = {
  isReady: false,
  isPlaying: false,
  hasAudio: true,
  audioLoaded: true,
  currentTimeMs: 0,
  durationMs: 120000,
  playbackRate: 1,
  play: mockPlay,
  pause: mockPause,
  seekTo: mockSeekTo,
  setPlaybackRate: mockSetPlaybackRate,
  download: mockDownload,
}

vi.mock('../../hooks/useAudioPlayer', () => ({
  useAudioPlayer: vi.fn(() => mockAudioPlayerState),
}))

import { AudioPlayer } from './AudioPlayer'

describe('AudioPlayer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAudioPlayerState.isReady = false
    mockAudioPlayerState.isPlaying = false
    mockAudioPlayerState.hasAudio = true
    mockAudioPlayerState.audioLoaded = true
    mockAudioPlayerState.currentTimeMs = 0
    mockAudioPlayerState.durationMs = 120000
    mockAudioPlayerState.playbackRate = 1
  })

  it('isReady=false일 때 로딩 상태를 표시한다', () => {
    mockAudioPlayerState.isReady = false
    render(<AudioPlayer meetingId={1} onTimeUpdate={vi.fn()} seekMs={null} />)
    expect(screen.getByText(/불러오는 중/)).toBeInTheDocument()
  })

  it('isReady=true이고 hasAudio=false이면 아무것도 렌더링하지 않는다', () => {
    mockAudioPlayerState.isReady = true
    mockAudioPlayerState.hasAudio = false
    const { container } = render(<AudioPlayer meetingId={1} onTimeUpdate={vi.fn()} seekMs={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('isReady=true일 때 재생 버튼이 표시된다', () => {
    mockAudioPlayerState.isReady = true
    mockAudioPlayerState.isPlaying = false
    render(<AudioPlayer meetingId={1} onTimeUpdate={vi.fn()} seekMs={null} />)
    // Play icon은 lucide의 Play SVG
    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBeGreaterThanOrEqual(1)
  })

  it('재생 버튼 클릭 시 play() 호출', () => {
    mockAudioPlayerState.isReady = true
    mockAudioPlayerState.isPlaying = false
    render(<AudioPlayer meetingId={1} onTimeUpdate={vi.fn()} seekMs={null} />)

    // 첫 번째 버튼이 재생/정지 버튼
    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[0])
    expect(mockPlay).toHaveBeenCalled()
  })

  it('isPlaying=true일 때 정지 버튼 클릭 시 pause() 호출', () => {
    mockAudioPlayerState.isReady = true
    mockAudioPlayerState.isPlaying = true
    render(<AudioPlayer meetingId={1} onTimeUpdate={vi.fn()} seekMs={null} />)

    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[0])
    expect(mockPause).toHaveBeenCalled()
  })

  it('현재 재생 시간을 표시한다', () => {
    mockAudioPlayerState.isReady = true
    mockAudioPlayerState.currentTimeMs = 65000 // 1분 5초
    render(<AudioPlayer meetingId={1} onTimeUpdate={vi.fn()} seekMs={null} />)

    // MM:SS 형태로 표시 (01:05)
    expect(screen.getByText(/01:05/)).toBeInTheDocument()
  })

  it('seekMs prop이 변경되면 seekTo가 호출된다', () => {
    const { rerender } = render(<AudioPlayer meetingId={1} onTimeUpdate={vi.fn()} seekMs={null} />)

    rerender(<AudioPlayer meetingId={1} onTimeUpdate={vi.fn()} seekMs={3000} />)
    expect(mockSeekTo).toHaveBeenCalledWith(3000)
  })

  it('배속 버튼이 현재 속도를 표시한다', () => {
    mockAudioPlayerState.isReady = true
    mockAudioPlayerState.playbackRate = 1.5
    render(<AudioPlayer meetingId={1} onTimeUpdate={vi.fn()} seekMs={null} />)
    expect(screen.getByText('1.5x')).toBeInTheDocument()
  })
})
