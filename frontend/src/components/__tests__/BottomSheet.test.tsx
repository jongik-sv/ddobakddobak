import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BottomSheet } from '../ui/BottomSheet'

describe('BottomSheet', () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    children: <div data-testid="sheet-content">콘텐츠</div>,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    // body overflow가 복원되었는지 확인
    document.body.style.overflow = ''
  })

  describe('렌더링', () => {
    it('open=true일 때 시트가 렌더링된다', () => {
      render(<BottomSheet {...defaultProps} />)

      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByTestId('sheet-content')).toBeInTheDocument()
    })

    it('open=false일 때 아무것도 렌더링하지 않는다', () => {
      render(<BottomSheet {...defaultProps} open={false} />)

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.queryByTestId('sheet-content')).not.toBeInTheDocument()
    })

    it('children 콘텐츠를 올바르게 렌더링한다', () => {
      render(<BottomSheet {...defaultProps} />)

      expect(screen.getByText('콘텐츠')).toBeInTheDocument()
    })

    it('title이 주어지면 헤더에 제목을 표시한다', () => {
      render(<BottomSheet {...defaultProps} title="설정" />)

      expect(screen.getByText('설정')).toBeInTheDocument()
    })

    it('title이 없으면 헤더 제목을 표시하지 않는다', () => {
      render(<BottomSheet {...defaultProps} />)

      expect(screen.queryByText('설정')).not.toBeInTheDocument()
    })

    it('핸들 바가 렌더링된다', () => {
      render(<BottomSheet {...defaultProps} />)

      expect(screen.getByTestId('bottom-sheet-handle')).toBeInTheDocument()
    })
  })

  describe('Portal 렌더링', () => {
    it('document.body에 Portal로 렌더링된다', () => {
      const { baseElement } = render(
        <div data-testid="parent">
          <BottomSheet {...defaultProps} />
        </div>,
      )

      // dialog가 parent 내부가 아닌 body 직속에 있는지 확인
      const dialog = screen.getByRole('dialog')
      expect(dialog.closest('[data-testid="parent"]')).toBeNull()
      expect(baseElement.contains(dialog)).toBe(true)
    })
  })

  describe('백드롭 클릭', () => {
    it('백드롭 클릭 시 onClose가 호출된다', async () => {
      render(<BottomSheet {...defaultProps} />)

      const backdrop = screen.getByTestId('bottom-sheet-backdrop')
      await userEvent.click(backdrop)

      expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
    })

    it('시트 내부 클릭 시 onClose가 호출되지 않는다', async () => {
      render(<BottomSheet {...defaultProps} />)

      const content = screen.getByTestId('sheet-content')
      await userEvent.click(content)

      expect(defaultProps.onClose).not.toHaveBeenCalled()
    })
  })

  describe('ESC 키 닫기', () => {
    it('ESC 키를 누르면 onClose가 호출된다', () => {
      render(<BottomSheet {...defaultProps} />)

      fireEvent.keyDown(document, { key: 'Escape' })

      expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
    })

    it('open=false일 때 ESC 키 이벤트를 리스닝하지 않는다', () => {
      render(<BottomSheet {...defaultProps} open={false} />)

      fireEvent.keyDown(document, { key: 'Escape' })

      expect(defaultProps.onClose).not.toHaveBeenCalled()
    })
  })

  describe('배경 스크롤 방지', () => {
    it('open=true일 때 body에 overflow: hidden이 적용된다', () => {
      render(<BottomSheet {...defaultProps} />)

      expect(document.body.style.overflow).toBe('hidden')
    })

    it('open=false로 전환되면 body overflow가 복원된다', () => {
      const { rerender } = render(<BottomSheet {...defaultProps} />)
      expect(document.body.style.overflow).toBe('hidden')

      rerender(<BottomSheet {...defaultProps} open={false} />)
      expect(document.body.style.overflow).toBe('')
    })

    it('컴포넌트 언마운트 시 body overflow가 복원된다', () => {
      const { unmount } = render(<BottomSheet {...defaultProps} />)
      expect(document.body.style.overflow).toBe('hidden')

      unmount()
      expect(document.body.style.overflow).toBe('')
    })
  })

  describe('접근성 (a11y)', () => {
    it('role="dialog"이 설정되어 있다', () => {
      render(<BottomSheet {...defaultProps} />)

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('aria-modal="true"가 설정되어 있다', () => {
      render(<BottomSheet {...defaultProps} />)

      expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
    })

    it('title이 있을 때 aria-label이 설정된다', () => {
      render(<BottomSheet {...defaultProps} title="필터" />)

      expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', '필터')
    })
  })

  describe('스타일 및 레이아웃', () => {
    it('시트 컨테이너에 max-h-[80vh] 관련 스타일이 적용된다', () => {
      render(<BottomSheet {...defaultProps} />)

      const sheet = screen.getByRole('dialog')
      expect(sheet.className).toContain('max-h-[80vh]')
    })

    it('시트 컨테이너에 fixed 포지셔닝이 적용된다', () => {
      render(<BottomSheet {...defaultProps} />)

      const sheet = screen.getByRole('dialog')
      expect(sheet.className).toContain('fixed')
      expect(sheet.className).toContain('bottom-0')
      expect(sheet.className).toContain('inset-x-0')
      expect(sheet.className).toContain('z-50')
    })

    it('className prop으로 추가 스타일을 적용할 수 있다', () => {
      render(<BottomSheet {...defaultProps} className="custom-class" />)

      const sheet = screen.getByRole('dialog')
      expect(sheet.className).toContain('custom-class')
    })

    it('콘텐츠 영역이 스크롤 가능하다 (overflow-y-auto)', () => {
      render(<BottomSheet {...defaultProps} />)

      const contentArea = screen.getByTestId('bottom-sheet-content')
      expect(contentArea.className).toContain('overflow-y-auto')
    })
  })

  describe('title이 있을 때 닫기 버튼', () => {
    it('title이 있으면 닫기 버튼이 표시된다', () => {
      render(<BottomSheet {...defaultProps} title="옵션" />)

      const closeButton = screen.getByRole('button', { name: /닫기/ })
      expect(closeButton).toBeInTheDocument()
    })

    it('닫기 버튼 클릭 시 onClose가 호출된다', async () => {
      render(<BottomSheet {...defaultProps} title="옵션" />)

      const closeButton = screen.getByRole('button', { name: /닫기/ })
      await userEvent.click(closeButton)

      expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
    })

    it('title이 없으면 닫기 버튼이 렌더링되지 않는다', () => {
      render(<BottomSheet {...defaultProps} />)

      expect(screen.queryByRole('button', { name: /닫기/ })).not.toBeInTheDocument()
    })
  })

  describe('엣지 케이스', () => {
    it('ESC가 아닌 다른 키를 누르면 onClose가 호출되지 않는다', () => {
      render(<BottomSheet {...defaultProps} />)

      fireEvent.keyDown(document, { key: 'Enter' })
      fireEvent.keyDown(document, { key: 'Tab' })
      fireEvent.keyDown(document, { key: 'ArrowDown' })

      expect(defaultProps.onClose).not.toHaveBeenCalled()
    })

    it('className이 undefined이면 클래스에 "undefined" 문자열이 포함되지 않는다', () => {
      render(<BottomSheet {...defaultProps} />)

      const sheet = screen.getByRole('dialog')
      expect(sheet.className).not.toContain('undefined')
    })

    it('title이 없을 때 aria-label이 undefined이다', () => {
      render(<BottomSheet {...defaultProps} />)

      const dialog = screen.getByRole('dialog')
      expect(dialog.getAttribute('aria-label')).toBeNull()
    })

    it('백드롭에 aria-hidden="true"가 설정되어 있다', () => {
      render(<BottomSheet {...defaultProps} />)

      const backdrop = screen.getByTestId('bottom-sheet-backdrop')
      expect(backdrop).toHaveAttribute('aria-hidden', 'true')
    })

    it('open 상태가 false에서 true로 바뀔 때 시트가 나타난다', () => {
      const { rerender } = render(<BottomSheet {...defaultProps} open={false} />)

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

      rerender(<BottomSheet {...defaultProps} open={true} />)

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('open 상태 토글(true→false→true)이 반복되어도 올바르게 동작한다', () => {
      const { rerender } = render(<BottomSheet {...defaultProps} open={true} />)
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(document.body.style.overflow).toBe('hidden')

      rerender(<BottomSheet {...defaultProps} open={false} />)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(document.body.style.overflow).toBe('')

      rerender(<BottomSheet {...defaultProps} open={true} />)
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(document.body.style.overflow).toBe('hidden')
    })

    it('콘텐츠 영역에 overscroll-contain 클래스가 적용된다', () => {
      render(<BottomSheet {...defaultProps} />)

      const contentArea = screen.getByTestId('bottom-sheet-content')
      expect(contentArea.className).toContain('overscroll-contain')
    })

    it('시트 컨테이너에 슬라이드 인 애니메이션 클래스가 적용된다', () => {
      render(<BottomSheet {...defaultProps} />)

      const sheet = screen.getByRole('dialog')
      expect(sheet.className).toContain('animate-slide-in-bottom')
    })

    it('시트 컨테이너에 rounded-t-2xl 클래스가 적용된다', () => {
      render(<BottomSheet {...defaultProps} />)

      const sheet = screen.getByRole('dialog')
      expect(sheet.className).toContain('rounded-t-2xl')
    })

    it('복잡한 children을 올바르게 렌더링한다', () => {
      const complexChildren = (
        <div>
          <h3>제목</h3>
          <ul>
            <li>항목 1</li>
            <li>항목 2</li>
          </ul>
          <button type="button">확인</button>
        </div>
      )

      render(<BottomSheet {...defaultProps}>{complexChildren}</BottomSheet>)

      expect(screen.getByText('제목')).toBeInTheDocument()
      expect(screen.getByText('항목 1')).toBeInTheDocument()
      expect(screen.getByText('항목 2')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '확인' })).toBeInTheDocument()
    })

    it('ESC 키를 여러 번 눌러도 각각 onClose가 호출된다', () => {
      render(<BottomSheet {...defaultProps} />)

      fireEvent.keyDown(document, { key: 'Escape' })
      fireEvent.keyDown(document, { key: 'Escape' })
      fireEvent.keyDown(document, { key: 'Escape' })

      expect(defaultProps.onClose).toHaveBeenCalledTimes(3)
    })

    it('백드롭은 fixed 포지셔닝 및 z-50이 적용된다', () => {
      render(<BottomSheet {...defaultProps} />)

      const backdrop = screen.getByTestId('bottom-sheet-backdrop')
      expect(backdrop.className).toContain('fixed')
      expect(backdrop.className).toContain('inset-0')
      expect(backdrop.className).toContain('z-50')
    })

    it('콘텐츠 영역에 pb-safe 클래스가 적용된다 (iOS safe area 대응)', () => {
      render(<BottomSheet {...defaultProps} />)

      const contentArea = screen.getByTestId('bottom-sheet-content')
      expect(contentArea.className).toContain('pb-safe')
    })

    it('open=false 상태에서 시작했다가 true로 변경 시 스크롤 방지가 적용된다', () => {
      const { rerender } = render(<BottomSheet {...defaultProps} open={false} />)
      expect(document.body.style.overflow).toBe('')

      rerender(<BottomSheet {...defaultProps} open={true} />)
      expect(document.body.style.overflow).toBe('hidden')
    })
  })
})
