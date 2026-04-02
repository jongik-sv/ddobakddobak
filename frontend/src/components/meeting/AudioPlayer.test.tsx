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
  durationMs: 60000,
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
    mockAudioPlayerState.durationMs = 60000
  })

  it('isReady=false일 때 로딩 상태를 표시한다', () => {
    mockAudioPlayerState.isReady = false
    render(<AudioPlayer meetingId={1} onTimeUpdate={vi.fn()} seekMs={null} />)
    expect(screen.getByText(/불러오는 중|로딩/)).toBeInTheDocument()
  })

  it('isReady=true && hasAudio=false일 때 null을 반환한다', () => {
    mockAudioPlayerState.isReady = true
    mockAudioPlayerState.hasAudio = false
    const { container } = render(<AudioPlayer meetingId={1} onTimeUpdate={vi.fn()} seekMs={null} />)
    expect(container.innerHTML).toBe('')
  })

  it('isReady=true일 때 재생 버튼이 표시된다', () => {
    mockAudioPlayerState.isReady = true
    mockAudioPlayerState.isPlaying = false
    render(<AudioPlayer meetingId={1} onTimeUpdate={vi.fn()} seekMs={null} />)
    // Play 아이콘 버튼이 존재해야 함 (button inside the player)
    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBeGreaterThan(0)
  })

  it('재생 버튼 클릭 시 play() 호출', () => {
    mockAudioPlayerState.isReady = true
    mockAudioPlayerState.isPlaying = false
    render(<AudioPlayer meetingId={1} onTimeUpdate={vi.fn()} seekMs={null} />)

    // 첫 번째 버튼이 재생/정지 버튼
    const playButton = screen.getAllByRole('button')[0]
    fireEvent.click(playButton)
    expect(mockPlay).toHaveBeenCalled()
  })

  it('isPlaying=true일 때 클릭 시 pause() 호출', () => {
    mockAudioPlayerState.isReady = true
    mockAudioPlayerState.isPlaying = true
    render(<AudioPlayer meetingId={1} onTimeUpdate={vi.fn()} seekMs={null} />)

    const pauseButton = screen.getAllByRole('button')[0]
    fireEvent.click(pauseButton)
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
})
