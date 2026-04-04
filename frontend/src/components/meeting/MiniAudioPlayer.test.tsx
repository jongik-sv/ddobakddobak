import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MiniAudioPlayer } from './MiniAudioPlayer'

describe('MiniAudioPlayer', () => {
  const defaultProps = {
    isPlaying: false,
    currentTimeMs: 0,
    durationMs: 120000, // 2분
    onPlay: vi.fn(),
    onPause: vi.fn(),
    onSeek: vi.fn(),
    onExpand: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('재생 버튼을 표시한다 (정지 상태)', () => {
    render(<MiniAudioPlayer {...defaultProps} isPlaying={false} />)
    const playBtn = screen.getByRole('button', { name: /재생/ })
    expect(playBtn).toBeInTheDocument()
  })

  it('일시정지 버튼을 표시한다 (재생 상태)', () => {
    render(<MiniAudioPlayer {...defaultProps} isPlaying={true} />)
    const pauseBtn = screen.getByRole('button', { name: /일시정지/ })
    expect(pauseBtn).toBeInTheDocument()
  })

  it('재생 버튼 클릭 시 onPlay 호출', () => {
    render(<MiniAudioPlayer {...defaultProps} isPlaying={false} />)
    fireEvent.click(screen.getByRole('button', { name: /재생/ }))
    expect(defaultProps.onPlay).toHaveBeenCalledOnce()
  })

  it('일시정지 버튼 클릭 시 onPause 호출', () => {
    render(<MiniAudioPlayer {...defaultProps} isPlaying={true} />)
    fireEvent.click(screen.getByRole('button', { name: /일시정지/ }))
    expect(defaultProps.onPause).toHaveBeenCalledOnce()
  })

  it('현재시간과 총시간을 표시한다', () => {
    render(<MiniAudioPlayer {...defaultProps} currentTimeMs={65000} durationMs={120000} />)
    expect(screen.getByText('01:05')).toBeInTheDocument()
    expect(screen.getByText('02:00')).toBeInTheDocument()
  })

  it('프로그레스 바(range input)가 존재한다', () => {
    render(<MiniAudioPlayer {...defaultProps} />)
    const range = screen.getByRole('slider')
    expect(range).toBeInTheDocument()
  })

  it('프로그레스 바 값이 현재 재생 위치를 반영한다', () => {
    render(<MiniAudioPlayer {...defaultProps} currentTimeMs={60000} durationMs={120000} />)
    const range = screen.getByRole('slider') as HTMLInputElement
    expect(Number(range.value)).toBe(60000)
  })

  it('프로그레스 바 변경 시 onSeek 호출', () => {
    render(<MiniAudioPlayer {...defaultProps} durationMs={120000} />)
    const range = screen.getByRole('slider')
    fireEvent.change(range, { target: { value: '30000' } })
    expect(defaultProps.onSeek).toHaveBeenCalledWith(30000)
  })

  it('확장 버튼 클릭 시 onExpand 호출', () => {
    render(<MiniAudioPlayer {...defaultProps} />)
    const expandBtn = screen.getByRole('button', { name: /확장/ })
    fireEvent.click(expandBtn)
    expect(defaultProps.onExpand).toHaveBeenCalledOnce()
  })

  it('lg:hidden 클래스가 적용되어 데스크톱에서 숨겨진다', () => {
    const { container } = render(<MiniAudioPlayer {...defaultProps} />)
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain('lg:hidden')
  })

  it('fixed bottom-14 위치가 적용된다', () => {
    const { container } = render(<MiniAudioPlayer {...defaultProps} />)
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain('fixed')
    expect(root.className).toContain('bottom-14')
  })
})
