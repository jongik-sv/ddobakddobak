import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Header from './Header'

describe('Header', () => {
  it('크래시 없이 렌더링됨', () => {
    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>
    )
    expect(document.querySelector('header')).toBeTruthy()
  })
})
