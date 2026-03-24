import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import SignupPage from './SignupPage'

const { mockNavigate, mockSignup } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockSignup: vi.fn(),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('../api/auth', () => ({ signup: mockSignup }))

describe('SignupPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('회원가입 페이지가 렌더링됨', () => {
    render(<MemoryRouter><SignupPage /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: /회원가입/i })).toBeInTheDocument()
  })

  it('이름, 이메일, 비밀번호 입력 필드가 존재함', () => {
    render(<MemoryRouter><SignupPage /></MemoryRouter>)
    expect(screen.getByLabelText(/이름/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/이메일/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/비밀번호/i)).toBeInTheDocument()
  })

  it('회원가입 성공 시 /dashboard로 이동', async () => {
    mockSignup.mockResolvedValue({
      token: 'jwt-token',
      user: { id: 1, email: 'test@example.com', name: '테스트' },
    })
    render(<MemoryRouter><SignupPage /></MemoryRouter>)

    await userEvent.type(screen.getByLabelText(/이름/i), '테스트')
    await userEvent.type(screen.getByLabelText(/이메일/i), 'test@example.com')
    await userEvent.type(screen.getByLabelText(/비밀번호/i), 'password123')
    await userEvent.click(screen.getByRole('button', { name: /회원가입/i }))

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard')
    })
  })

  it('회원가입 실패 시 에러 메시지 표시', async () => {
    mockSignup.mockRejectedValue(new Error('이미 사용 중인 이메일'))
    render(<MemoryRouter><SignupPage /></MemoryRouter>)

    await userEvent.type(screen.getByLabelText(/이름/i), '테스트')
    await userEvent.type(screen.getByLabelText(/이메일/i), 'exists@example.com')
    await userEvent.type(screen.getByLabelText(/비밀번호/i), 'password123')
    await userEvent.click(screen.getByRole('button', { name: /회원가입/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
  })

  it('로그인 페이지 링크가 존재함', () => {
    render(<MemoryRouter><SignupPage /></MemoryRouter>)
    expect(screen.getByRole('link', { name: /로그인/i })).toBeInTheDocument()
  })
})
