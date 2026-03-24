import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// useAudioPlayer 훅을 mock
const mockPlay = vi.fn()
const mockPause = vi.fn()
const mockSeekTo = vi.fn()

const mockAudioPlayerState = {
  isReady: false,
  isPlaying: false,
  currentTimeMs: 0,
  play: mockPlay,
  pause: mockPause,
  seekTo: mockSeekTo,
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
    mockAudioPlayerState.currentTimeMs = 0
  })

  it('파형 컨테이너 div가 렌더링된다', () => {
    render(<AudioPlayer meetingId={1} onTimeUpdate={vi.fn()} seekMs={null} />)
    // waveform div가 존재해야 함
    const waveform = document.querySelector('[data-testid="waveform"]')
    expect(waveform).toBeInTheDocument()
  })

  it('isReady=false일 때 로딩 상태를 표시한다', () => {
    mockAudioPlayerState.isReady = false
    render(<AudioPlayer meetingId={1} onTimeUpdate={vi.fn()} seekMs={null} />)
    expect(screen.getByText(/불러오는 중|로딩/)).toBeInTheDocument()
  })

  it('isReady=true일 때 재생 버튼이 표시된다', () => {
    mockAudioPlayerState.isReady = true
    mockAudioPlayerState.isPlaying = false
    render(<AudioPlayer meetingId={1} onTimeUpdate={vi.fn()} seekMs={null} />)
    expect(screen.getByRole('button', { name: /재생|play/i })).toBeInTheDocument()
  })

  it('재생 버튼 클릭 시 play() 호출', () => {
    mockAudioPlayerState.isReady = true
    mockAudioPlayerState.isPlaying = false
    render(<AudioPlayer meetingId={1} onTimeUpdate={vi.fn()} seekMs={null} />)

    fireEvent.click(screen.getByRole('button', { name: /재생|play/i }))
    expect(mockPlay).toHaveBeenCalled()
  })

  it('isPlaying=true일 때 정지 버튼이 표시된다', () => {
    mockAudioPlayerState.isReady = true
    mockAudioPlayerState.isPlaying = true
    render(<AudioPlayer meetingId={1} onTimeUpdate={vi.fn()} seekMs={null} />)
    expect(screen.getByRole('button', { name: /정지|pause/i })).toBeInTheDocument()
  })

  it('정지 버튼 클릭 시 pause() 호출', () => {
    mockAudioPlayerState.isReady = true
    mockAudioPlayerState.isPlaying = true
    render(<AudioPlayer meetingId={1} onTimeUpdate={vi.fn()} seekMs={null} />)

    fireEvent.click(screen.getByRole('button', { name: /정지|pause/i }))
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
