import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AudioRecorder } from './AudioRecorder'
import * as useAudioRecorderModule from '../../hooks/useAudioRecorder'

vi.mock('../../hooks/useAudioRecorder')

const mockStart = vi.fn()
const mockStop = vi.fn()

const mockPause = vi.fn()
const mockResume = vi.fn()

function stubHook(isRecording: boolean, error: string | null = null) {
  vi.mocked(useAudioRecorderModule.useAudioRecorder).mockReturnValue({
    isRecording,
    isPaused: false,
    error,
    start: mockStart,
    stop: mockStop,
    pause: mockPause,
    resume: mockResume,
  })
}

describe('AudioRecorder', () => {
  const props = { onChunk: vi.fn(), onStop: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('비녹음 상태에서 "녹음 시작" 버튼 표시', () => {
    stubHook(false)
    render(<AudioRecorder {...props} />)
    expect(screen.getByRole('button', { name: '녹음 시작' })).toBeInTheDocument()
  })

  it('녹음 중 상태에서 "녹음 중지" 버튼 표시', () => {
    stubHook(true)
    render(<AudioRecorder {...props} />)
    expect(screen.getByRole('button', { name: '녹음 중지' })).toBeInTheDocument()
  })

  it('녹음 중 상태에서 녹음 표시등("녹음 중") 표시', () => {
    stubHook(true)
    render(<AudioRecorder {...props} />)
    expect(screen.getByText('녹음 중')).toBeInTheDocument()
  })

  it('비녹음 상태에서 녹음 표시등 미표시', () => {
    stubHook(false)
    render(<AudioRecorder {...props} />)
    expect(screen.queryByText('녹음 중')).not.toBeInTheDocument()
  })

  it('"녹음 시작" 클릭 시 start() 호출', () => {
    stubHook(false)
    render(<AudioRecorder {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '녹음 시작' }))
    expect(mockStart).toHaveBeenCalled()
  })

  it('"녹음 중지" 클릭 시 stop() 호출', () => {
    stubHook(true)
    render(<AudioRecorder {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '녹음 중지' }))
    expect(mockStop).toHaveBeenCalled()
  })

  it('에러 발생 시 에러 메시지 표시', () => {
    stubHook(false, 'Permission denied')
    render(<AudioRecorder {...props} />)
    expect(screen.getByText('Permission denied')).toBeInTheDocument()
  })
})
