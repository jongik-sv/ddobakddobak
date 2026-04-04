import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import AppLayout from './AppLayout'
import { useUiStore } from '../../stores/uiStore'

// Mock child components to isolate AppLayout tests
vi.mock('./Sidebar', () => ({
  default: () => <div data-testid="sidebar">Sidebar</div>,
}))

vi.mock('./BottomNavigation', () => ({
  default: ({ className }: { className?: string }) => (
    <nav data-testid="bottom-navigation" className={className}>
      BottomNavigation
    </nav>
  ),
}))

vi.mock('./MobileSidebarOverlay', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="mobile-sidebar-overlay" role="dialog">
      <button onClick={onClose} data-testid="overlay-close">
        Close
      </button>
    </div>
  ),
}))

function renderLayout(children = <div>테스트 콘텐츠</div>) {
  return render(
    <MemoryRouter>
      <AppLayout>{children}</AppLayout>
    </MemoryRouter>
  )
}

describe('AppLayout', () => {
  beforeEach(() => {
    // Reset uiStore to default state before each test
    useUiStore.setState({
      sidebarOpen: true,
      mobileMenuOpen: false,
    })
  })

  // --- 기본 렌더링 ---

  it('children이 렌더링됨', () => {
    renderLayout(<div>메인 콘텐츠</div>)
    expect(screen.getByText('메인 콘텐츠')).toBeInTheDocument()
  })

  it('메인 영역(main 태그)이 렌더링됨', () => {
    renderLayout()
    expect(document.querySelector('main')).toBeTruthy()
  })

  // --- h-dvh 클래스 ---

  it('루트 컨테이너에 h-dvh 클래스가 적용됨', () => {
    renderLayout()
    const root = document.querySelector('.h-dvh')
    expect(root).toBeTruthy()
    expect(root?.classList.contains('flex')).toBe(true)
    expect(root?.classList.contains('flex-col')).toBe(true)
  })

  // --- 데스크톱 사이드바 영역 ---

  it('데스크톱 사이드바 영역에 hidden lg:block 클래스가 적용됨', () => {
    renderLayout()
    const sidebar = screen.getByTestId('sidebar')
    const desktopWrapper = sidebar.closest('.hidden.lg\\:block')
    expect(desktopWrapper).toBeTruthy()
  })

  it('sidebarOpen=true일 때 Sidebar가 렌더링됨', () => {
    useUiStore.setState({ sidebarOpen: true })
    renderLayout()
    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
  })

  it('sidebarOpen=false일 때 사이드바 열기 버튼이 렌더링됨', () => {
    useUiStore.setState({ sidebarOpen: false })
    renderLayout()
    expect(screen.getByTitle('사이드바 열기')).toBeInTheDocument()
  })

  // --- 모바일 헤더 ---

  it('모바일 헤더에 lg:hidden 클래스가 적용됨', () => {
    renderLayout()
    const header = document.querySelector('header')
    expect(header).toBeTruthy()
    expect(header?.classList.contains('lg:hidden')).toBe(true)
  })

  it('모바일 헤더에 햄버거 메뉴 버튼(aria-label="메뉴 열기")이 있음', () => {
    renderLayout()
    const menuButton = screen.getByLabelText('메뉴 열기')
    expect(menuButton).toBeInTheDocument()
    expect(menuButton.tagName).toBe('BUTTON')
  })

  it('모바일 헤더에 "또박또박" 앱 이름이 표시됨', () => {
    renderLayout()
    expect(screen.getByText('또박또박')).toBeInTheDocument()
  })

  // --- BottomNavigation ---

  it('BottomNavigation이 렌더링됨', () => {
    renderLayout()
    expect(screen.getByTestId('bottom-navigation')).toBeInTheDocument()
  })

  it('BottomNavigation에 lg:hidden className이 전달됨', () => {
    renderLayout()
    const bottomNav = screen.getByTestId('bottom-navigation')
    expect(bottomNav.className).toContain('lg:hidden')
  })

  // --- 메인 콘텐츠 패딩 ---

  it('main 영역에 pb-14 lg:pb-0 클래스가 적용됨', () => {
    renderLayout()
    const main = document.querySelector('main')
    expect(main).toBeTruthy()
    expect(main?.classList.contains('pb-14')).toBe(true)
    expect(main?.classList.contains('lg:pb-0')).toBe(true)
  })

  // --- MobileSidebarOverlay 토글 ---

  it('mobileMenuOpen=false일 때 MobileSidebarOverlay가 렌더링되지 않음', () => {
    useUiStore.setState({ mobileMenuOpen: false })
    renderLayout()
    expect(screen.queryByTestId('mobile-sidebar-overlay')).not.toBeInTheDocument()
  })

  it('mobileMenuOpen=true일 때 MobileSidebarOverlay가 렌더링됨', () => {
    useUiStore.setState({ mobileMenuOpen: true })
    renderLayout()
    expect(screen.getByTestId('mobile-sidebar-overlay')).toBeInTheDocument()
  })

  it('햄버거 메뉴 버튼 클릭 시 mobileMenuOpen이 true로 변경됨', () => {
    useUiStore.setState({ mobileMenuOpen: false })
    renderLayout()
    fireEvent.click(screen.getByLabelText('메뉴 열기'))
    expect(useUiStore.getState().mobileMenuOpen).toBe(true)
  })

  it('MobileSidebarOverlay onClose 호출 시 mobileMenuOpen이 false로 변경됨', () => {
    useUiStore.setState({ mobileMenuOpen: true })
    renderLayout()
    fireEvent.click(screen.getByTestId('overlay-close'))
    expect(useUiStore.getState().mobileMenuOpen).toBe(false)
  })

  // --- 반응형 레이아웃 구조 ---

  it('루트 컨테이너에 lg:flex-row 클래스가 적용됨 (데스크톱 가로 배치)', () => {
    renderLayout()
    const root = document.querySelector('.h-dvh')
    expect(root?.classList.contains('lg:flex-row')).toBe(true)
  })

  it('루트 컨테이너에 overflow-hidden 클래스가 적용됨', () => {
    renderLayout()
    const root = document.querySelector('.h-dvh')
    expect(root?.classList.contains('overflow-hidden')).toBe(true)
  })
})
