import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MobileRecordControls } from './MobileRecordControls'

describe('MobileRecordControls', () => {
  const defaultProps = {
    title: '테스트 회의',
    isRecording: false,
    isPaused: false,
    elapsedSeconds: 0,
    onBack: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onStop: vi.fn(),
    isStopping: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ─── 렌더링: 녹음 중이 아닐 때는 표시되지 않음 ───

  it('녹음 중이 아닐 때는 렌더링되지 않음', () => {
    const { container } = render(<MobileRecordControls {...defaultProps} isRecording={false} />)
    expect(container.firstChild).toBeNull()
  })

  // ─── 상단 고정 바 ───

  it('녹음 중일 때 상단 고정 바가 표시됨', () => {
    render(<MobileRecordControls {...defaultProps} isRecording={true} />)
    const bar = screen.getByTestId('mobile-record-controls')
    expect(bar).toBeInTheDocument()
  })

  it('뒤로가기 버튼이 표시됨', () => {
    render(<MobileRecordControls {...defaultProps} isRecording={true} />)
    expect(screen.getByRole('button', { name: /뒤로/i })).toBeInTheDocument()
  })

  it('뒤로가기 버튼 클릭 시 onBack 호출', () => {
    render(<MobileRecordControls {...defaultProps} isRecording={true} />)
    fireEvent.click(screen.getByRole('button', { name: /뒤로/i }))
    expect(defaultProps.onBack).toHaveBeenCalledOnce()
  })

  it('제목이 truncate로 표시됨', () => {
    render(<MobileRecordControls {...defaultProps} isRecording={true} title="아주 긴 회의 제목 테스트" />)
    const titleEl = screen.getByText('아주 긴 회의 제목 테스트')
    expect(titleEl).toBeInTheDocument()
    expect(titleEl).toHaveClass('truncate')
  })

  it('녹음 상태 표시 (빨간 점 + 타이머)', () => {
    render(<MobileRecordControls {...defaultProps} isRecording={true} elapsedSeconds={65} />)
    // 녹음 인디케이터 (빨간 점)
    expect(screen.getByTestId('mobile-recording-dot')).toBeInTheDocument()
    // 타이머 표시 (01:05)
    expect(screen.getByText('01:05')).toBeInTheDocument()
  })

  it('1시간 이상 경과 시 시:분:초 형식으로 표시', () => {
    render(<MobileRecordControls {...defaultProps} isRecording={true} elapsedSeconds={3661} />)
    expect(screen.getByText('01:01:01')).toBeInTheDocument()
  })

  // ─── 핵심 버튼: 일시정지, 종료 ───

  it('일시정지 버튼이 표시됨 (녹음 중)', () => {
    render(<MobileRecordControls {...defaultProps} isRecording={true} isPaused={false} />)
    expect(screen.getByRole('button', { name: /일시정지/i })).toBeInTheDocument()
  })

  it('일시정지 버튼 클릭 시 onPause 호출', () => {
    render(<MobileRecordControls {...defaultProps} isRecording={true} isPaused={false} />)
    fireEvent.click(screen.getByRole('button', { name: /일시정지/i }))
    expect(defaultProps.onPause).toHaveBeenCalledOnce()
  })

  it('일시정지 상태에서 재개 버튼이 표시됨', () => {
    render(<MobileRecordControls {...defaultProps} isRecording={true} isPaused={true} />)
    expect(screen.getByRole('button', { name: /재개/i })).toBeInTheDocument()
  })

  it('재개 버튼 클릭 시 onResume 호출', () => {
    render(<MobileRecordControls {...defaultProps} isRecording={true} isPaused={true} />)
    fireEvent.click(screen.getByRole('button', { name: /재개/i }))
    expect(defaultProps.onResume).toHaveBeenCalledOnce()
  })

  it('종료 버튼이 표시됨', () => {
    render(<MobileRecordControls {...defaultProps} isRecording={true} />)
    expect(screen.getByRole('button', { name: /종료/i })).toBeInTheDocument()
  })

  it('종료 버튼 클릭 시 onStop 호출', () => {
    render(<MobileRecordControls {...defaultProps} isRecording={true} />)
    fireEvent.click(screen.getByRole('button', { name: /종료/i }))
    expect(defaultProps.onStop).toHaveBeenCalledOnce()
  })

  it('종료 중일 때 종료 버튼이 비활성화됨', () => {
    render(<MobileRecordControls {...defaultProps} isRecording={true} isStopping={true} />)
    const stopBtn = screen.getByRole('button', { name: /종료/i })
    expect(stopBtn).toBeDisabled()
  })

  // ─── 더보기 버튼 → 바텀 시트 ───

  it('더보기 버튼이 표시됨', () => {
    render(<MobileRecordControls {...defaultProps} isRecording={true} />)
    expect(screen.getByRole('button', { name: /더보기/i })).toBeInTheDocument()
  })

  it('더보기 버튼 탭 시 추가 옵션 오버레이 표시', () => {
    render(<MobileRecordControls {...defaultProps} isRecording={true} />)
    fireEvent.click(screen.getByRole('button', { name: /더보기/i }))
    expect(screen.getByTestId('mobile-more-options')).toBeInTheDocument()
  })

  it('추가 옵션 오버레이에 children이 표시됨', () => {
    render(
      <MobileRecordControls {...defaultProps} isRecording={true}>
        <button>STT 엔진</button>
        <button>마이크 선택</button>
      </MobileRecordControls>
    )
    fireEvent.click(screen.getByRole('button', { name: /더보기/i }))
    expect(screen.getByText('STT 엔진')).toBeInTheDocument()
    expect(screen.getByText('마이크 선택')).toBeInTheDocument()
  })

  it('추가 옵션 오버레이의 닫기 버튼으로 닫을 수 있음', () => {
    render(<MobileRecordControls {...defaultProps} isRecording={true} />)
    fireEvent.click(screen.getByRole('button', { name: /더보기/i }))
    expect(screen.getByTestId('mobile-more-options')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /닫기/i }))
    expect(screen.queryByTestId('mobile-more-options')).not.toBeInTheDocument()
  })

  // ─── 데스크톱에서는 숨김 ───

  it('lg:hidden 클래스가 적용되어 데스크톱에서 숨겨짐', () => {
    render(<MobileRecordControls {...defaultProps} isRecording={true} />)
    const bar = screen.getByTestId('mobile-record-controls')
    expect(bar.className).toContain('lg:hidden')
  })

  // ─── 일시정지 상태 UI 변경 ───

  it('일시정지 상태에서 배경색이 amber 계열로 변경됨', () => {
    render(<MobileRecordControls {...defaultProps} isRecording={true} isPaused={true} />)
    const bar = screen.getByTestId('mobile-record-controls')
    expect(bar.className).toContain('bg-amber-50')
  })

  it('녹음 중 상태에서 배경색이 red 계열', () => {
    render(<MobileRecordControls {...defaultProps} isRecording={true} isPaused={false} />)
    const bar = screen.getByTestId('mobile-record-controls')
    expect(bar.className).toContain('bg-red-50')
  })
})
