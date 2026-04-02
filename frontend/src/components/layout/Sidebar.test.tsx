import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Sidebar from './Sidebar'
import { useUiStore } from '../../stores/uiStore'

// Mock FolderTree to avoid its dependencies
vi.mock('../folder/FolderTree', () => ({
  default: () => <div data-testid="folder-tree" />,
}))

describe('Sidebar', () => {
  beforeEach(() => {
    // 사이드바를 열린 상태로 설정
    useUiStore.setState({ sidebarOpen: true })
  })

  it('대시보드 링크가 렌더링됨', () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    )
    expect(screen.getByText(/대시보드/i)).toBeInTheDocument()
  })

  it('회의 목록 링크가 렌더링됨', () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    )
    expect(screen.getByText(/회의 목록/i)).toBeInTheDocument()
  })

  it('대시보드 링크 href가 /dashboard임', () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    )
    const dashboardLink = screen.getByRole('link', { name: /대시보드/i })
    expect(dashboardLink).toHaveAttribute('href', '/dashboard')
  })

  it('회의 목록 링크 href가 /meetings임', () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    )
    const meetingsLink = screen.getByRole('link', { name: /회의 목록/i })
    expect(meetingsLink).toHaveAttribute('href', '/meetings')
  })

  it('설정 버튼이 렌더링됨', () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    )
    expect(screen.getByRole('button', { name: /설정/i })).toBeInTheDocument()
  })

  it('sidebarOpen=false일 때 사이드바가 렌더링되지 않음', () => {
    useUiStore.setState({ sidebarOpen: false })
    const { container } = render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    )
    expect(container.innerHTML).toBe('')
  })
})
