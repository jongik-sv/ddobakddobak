import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AudioPlayer } from './AudioPlayer'
import type { AudioPlayerResult } from '../../hooks/useAudioPlayer'

const mockPlay = vi.fn()
const mockPause = vi.fn()
const mockSeekTo = vi.fn()
const mockSetPlaybackRate = vi.fn()
const mockDownload = vi.fn()

function makeAudio(overrides: Partial<AudioPlayerResult> = {}): AudioPlayerResult {
  return {
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
    ...overrides,
  }
}

describe('AudioPlayer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('isReady=false일 때 로딩 상태를 표시한다', () => {
    render(<AudioPlayer audio={makeAudio({ isReady: false })} onTimeUpdate={vi.fn()} seekMs={null} />)
    expect(screen.getByText(/불러오는 중|로딩/)).toBeInTheDocument()
  })

  it('isReady=true && hasAudio=false일 때 null을 반환한다', () => {
    const { container } = render(<AudioPlayer audio={makeAudio({ isReady: true, hasAudio: false })} onTimeUpdate={vi.fn()} seekMs={null} />)
    expect(container.innerHTML).toBe('')
  })

  it('isReady=true일 때 재생 버튼이 표시된다', () => {
    render(<AudioPlayer audio={makeAudio({ isReady: true })} onTimeUpdate={vi.fn()} seekMs={null} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBeGreaterThan(0)
  })

  it('재생 버튼 클릭 시 play() 호출', () => {
    render(<AudioPlayer audio={makeAudio({ isReady: true })} onTimeUpdate={vi.fn()} seekMs={null} />)
    const playButton = screen.getAllByRole('button')[0]
    fireEvent.click(playButton)
    expect(mockPlay).toHaveBeenCalled()
  })

  it('isPlaying=true일 때 클릭 시 pause() 호출', () => {
    render(<AudioPlayer audio={makeAudio({ isReady: true, isPlaying: true })} onTimeUpdate={vi.fn()} seekMs={null} />)
    const pauseButton = screen.getAllByRole('button')[0]
    fireEvent.click(pauseButton)
    expect(mockPause).toHaveBeenCalled()
  })

  it('현재 재생 시간을 표시한다', () => {
    render(<AudioPlayer audio={makeAudio({ isReady: true, currentTimeMs: 65000 })} onTimeUpdate={vi.fn()} seekMs={null} />)
    expect(screen.getByText(/01:05/)).toBeInTheDocument()
  })

  it('seekMs prop이 변경되면 seekTo가 호출된다', () => {
    const audio = makeAudio({ isReady: true })
    const { rerender } = render(<AudioPlayer audio={audio} onTimeUpdate={vi.fn()} seekMs={null} />)
    rerender(<AudioPlayer audio={audio} onTimeUpdate={vi.fn()} seekMs={3000} />)
    expect(mockSeekTo).toHaveBeenCalledWith(3000)
  })
})
