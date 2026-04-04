import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import MobileSidebarOverlay from './MobileSidebarOverlay'

// Mock Sidebar to isolate MobileSidebarOverlay tests
vi.mock('./Sidebar', () => ({
  default: () => <div data-testid="sidebar">Sidebar</div>,
}))

function renderOverlay(onClose = vi.fn()) {
  return {
    onClose,
    ...render(
      <MemoryRouter>
        <MobileSidebarOverlay onClose={onClose} />
      </MemoryRouter>
    ),
  }
}

describe('MobileSidebarOverlay', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('Sidebar 컴포넌트가 렌더링됨', () => {
    renderOverlay()
    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
  })

  it('role="dialog" 및 aria-modal="true" 접근성 속성이 설정됨', () => {
    renderOverlay()
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-label', '사이드바 메뉴')
  })

  it('백드롭 클릭 시 onClose가 호출됨', () => {
    const onClose = vi.fn()
    renderOverlay(onClose)
    // 백드롭은 aria-hidden="true"인 요소
    const backdrop = document.querySelector('[aria-hidden="true"]')
    expect(backdrop).toBeTruthy()
    fireEvent.click(backdrop!)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('사이드바 영역 클릭 시 onClose가 호출되지 않음 (stopPropagation)', () => {
    const onClose = vi.fn()
    renderOverlay(onClose)
    fireEvent.click(screen.getByTestId('sidebar'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Escape 키 입력 시 onClose가 호출됨', () => {
    const onClose = vi.fn()
    renderOverlay(onClose)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Escape 외 다른 키 입력 시 onClose가 호출되지 않음', () => {
    const onClose = vi.fn()
    renderOverlay(onClose)
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('사이드바 패널에 animate-slide-in-left 클래스가 적용됨', () => {
    renderOverlay()
    const sidebarPanel = screen.getByTestId('sidebar').parentElement
    expect(sidebarPanel?.className).toContain('animate-slide-in-left')
  })

  it('오버레이가 z-50 클래스를 가짐', () => {
    renderOverlay()
    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toContain('z-50')
  })

  it('언마운트 시 keydown 이벤트 리스너가 정리됨', () => {
    const addSpy = vi.spyOn(document, 'addEventListener')
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    const { unmount } = renderOverlay()

    expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
    unmount()
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
  })

  it('마운트 시 body overflow가 hidden으로 설정됨', () => {
    renderOverlay()
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('언마운트 시 body overflow가 원래 값으로 복원됨', () => {
    document.body.style.overflow = 'auto'
    const { unmount } = renderOverlay()
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('auto')
  })

  it('사이드바 패널에 h-full 클래스가 적용됨', () => {
    renderOverlay()
    const sidebarPanel = screen.getByTestId('sidebar').parentElement
    expect(sidebarPanel?.className).toContain('h-full')
  })
})
