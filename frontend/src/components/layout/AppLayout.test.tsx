import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import AppLayout from './AppLayout'

describe('AppLayout', () => {
  it('children이 렌더링됨', () => {
    render(
      <MemoryRouter>
        <AppLayout>
          <div>메인 콘텐츠</div>
        </AppLayout>
      </MemoryRouter>
    )
    expect(screen.getByText('메인 콘텐츠')).toBeInTheDocument()
  })

  it('사이드바가 렌더링됨', () => {
    render(
      <MemoryRouter>
        <AppLayout>
          <div>콘텐츠</div>
        </AppLayout>
      </MemoryRouter>
    )
    expect(screen.getByRole('link', { name: /대시보드/i })).toBeInTheDocument()
  })

  it('메인 영역이 렌더링됨', () => {
    render(
      <MemoryRouter>
        <AppLayout>
          <div>콘텐츠</div>
        </AppLayout>
      </MemoryRouter>
    )
    expect(document.querySelector('main')).toBeTruthy()
  })
})
