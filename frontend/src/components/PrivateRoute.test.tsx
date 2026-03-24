import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import PrivateRoute from './PrivateRoute'
import { useAuthStore } from '../stores/authStore'

function ProtectedContent() {
  return <div>Protected Content</div>
}

function renderWithRoutes(authenticated: boolean) {
  if (authenticated) {
    useAuthStore.getState().login('test-token', { id: 1, email: 'test@example.com', name: '테스트' })
  }
  return render(
    <MemoryRouter initialEntries={['/protected']}>
      <Routes>
        <Route path="/login" element={<div>Login Page</div>} />
        <Route element={<PrivateRoute />}>
          <Route path="/protected" element={<ProtectedContent />} />
        </Route>
      </Routes>
    </MemoryRouter>
  )
}

describe('PrivateRoute', () => {
  beforeEach(() => {
    useAuthStore.getState().logout()
  })

  it('미인증 시 /login으로 리다이렉트', () => {
    renderWithRoutes(false)
    expect(screen.getByText('Login Page')).toBeInTheDocument()
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument()
  })

  it('인증 시 protected content 렌더링', () => {
    renderWithRoutes(true)
    expect(screen.getByText('Protected Content')).toBeInTheDocument()
    expect(screen.queryByText('Login Page')).not.toBeInTheDocument()
  })
})
