import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Sidebar from './Sidebar'

describe('Sidebar', () => {
  it('대시보드 링크가 렌더링됨', () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    )
    expect(screen.getByRole('link', { name: /대시보드/i })).toBeInTheDocument()
  })

  it('팀 목록 링크가 렌더링됨', () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    )
    expect(screen.getByRole('link', { name: /팀 목록/i })).toBeInTheDocument()
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

  it('팀 목록 링크 href가 /teams임', () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    )
    const teamsLink = screen.getByRole('link', { name: /팀 목록/i })
    expect(teamsLink).toHaveAttribute('href', '/teams')
  })

  it('md 이하에서 숨김 클래스를 가짐', () => {
    const { container } = render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    )
    const sidebar = container.firstChild as HTMLElement
    expect(sidebar.className).toMatch(/hidden/)
    expect(sidebar.className).toMatch(/md:/)
  })
})
