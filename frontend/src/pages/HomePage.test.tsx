import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import HomePage from './HomePage'

describe('HomePage', () => {
  it('홈 페이지가 렌더링됨', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    )
    expect(screen.getByText(/또박또박/i)).toBeInTheDocument()
  })

  it('로그인 링크가 존재함', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    )
    expect(screen.getByRole('link', { name: /로그인/i })).toBeInTheDocument()
  })
})
