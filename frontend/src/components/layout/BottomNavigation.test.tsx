import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import BottomNavigation from './BottomNavigation'
import { useUiStore } from '../../stores/uiStore'

// react-router-dom useNavigate mock
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

describe('BottomNavigation', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
    useUiStore.setState({ settingsOpen: false })
  })

  it('4개 내비 항목이 렌더링됨', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <BottomNavigation />
      </MemoryRouter>
    )
    expect(screen.getByText('홈')).toBeInTheDocument()
    expect(screen.getByText('회의')).toBeInTheDocument()
    expect(screen.getByText('검색')).toBeInTheDocument()
    expect(screen.getByText('설정')).toBeInTheDocument()
  })

  it('현재 경로에 해당하는 항목이 활성 상태', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <BottomNavigation />
      </MemoryRouter>
    )
    const homeButton = screen.getByText('홈').closest('button')
    expect(homeButton).toHaveAttribute('aria-current', 'page')
  })

  it('/meetings/:id 경로에서 회의 탭이 활성', () => {
    render(
      <MemoryRouter initialEntries={['/meetings/123']}>
        <BottomNavigation />
      </MemoryRouter>
    )
    const meetingsButton = screen.getByText('회의').closest('button')
    expect(meetingsButton).toHaveAttribute('aria-current', 'page')
  })

  it('/meetings/:id/live 경로에서도 회의 탭이 활성', () => {
    render(
      <MemoryRouter initialEntries={['/meetings/123/live']}>
        <BottomNavigation />
      </MemoryRouter>
    )
    const meetingsButton = screen.getByText('회의').closest('button')
    expect(meetingsButton).toHaveAttribute('aria-current', 'page')
  })

  it('/search 경로에서 검색 탭이 활성', () => {
    render(
      <MemoryRouter initialEntries={['/search']}>
        <BottomNavigation />
      </MemoryRouter>
    )
    const searchButton = screen.getByText('검색').closest('button')
    expect(searchButton).toHaveAttribute('aria-current', 'page')
  })

  it('/dashboard 경로에서 비활성 항목에 aria-current가 없음', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <BottomNavigation />
      </MemoryRouter>
    )
    const meetingsButton = screen.getByText('회의').closest('button')
    expect(meetingsButton).not.toHaveAttribute('aria-current')
  })

  it('홈 클릭 시 /dashboard로 navigate', () => {
    render(
      <MemoryRouter initialEntries={['/meetings']}>
        <BottomNavigation />
      </MemoryRouter>
    )
    fireEvent.click(screen.getByText('홈'))
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard')
  })

  it('회의 클릭 시 /meetings로 navigate', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <BottomNavigation />
      </MemoryRouter>
    )
    fireEvent.click(screen.getByText('회의'))
    expect(mockNavigate).toHaveBeenCalledWith('/meetings')
  })

  it('검색 클릭 시 /search로 navigate', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <BottomNavigation />
      </MemoryRouter>
    )
    fireEvent.click(screen.getByText('검색'))
    expect(mockNavigate).toHaveBeenCalledWith('/search')
  })

  it('설정 클릭 시 navigate 대신 openSettings 호출', () => {
    render(
      <MemoryRouter initialEntries={['/meetings']}>
        <BottomNavigation />
      </MemoryRouter>
    )
    fireEvent.click(screen.getByText('설정'))
    expect(mockNavigate).not.toHaveBeenCalledWith('/settings')
    expect(useUiStore.getState().settingsOpen).toBe(true)
  })

  it('nav 요소에 aria-label 존재', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <BottomNavigation />
      </MemoryRouter>
    )
    expect(screen.getByRole('navigation', { name: '모바일 내비게이션' })).toBeInTheDocument()
  })

  it('className prop이 적용됨', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <BottomNavigation className="lg:hidden" />
      </MemoryRouter>
    )
    const nav = container.querySelector('nav')
    expect(nav?.className).toContain('lg:hidden')
  })
})
