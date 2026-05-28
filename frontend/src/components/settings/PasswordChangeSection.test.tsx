import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const changePassword = vi.fn()
vi.mock('../../api/account', () => ({ changePassword: (...a: unknown[]) => changePassword(...a) }))

const setTokens = vi.fn()
vi.mock('../../stores/authStore', () => ({
  useAuthStore: { getState: () => ({ setTokens }) },
}))

import PasswordChangeSection from './PasswordChangeSection'

beforeEach(() => {
  changePassword.mockReset()
  setTokens.mockReset()
})

describe('PasswordChangeSection', () => {
  it('submits change and stores reissued tokens', async () => {
    changePassword.mockResolvedValue({ access_token: 'AAA', refresh_token: 'RRR' })
    render(<PasswordChangeSection />)

    fireEvent.change(screen.getByLabelText('현재 비밀번호'), { target: { value: 'old' } })
    fireEvent.change(screen.getByLabelText('새 비밀번호'), { target: { value: 'newpassword456' } })
    fireEvent.change(screen.getByLabelText('새 비밀번호 확인'), { target: { value: 'newpassword456' } })
    fireEvent.click(screen.getByRole('button', { name: '비밀번호 변경' }))

    await waitFor(() => {
      expect(changePassword).toHaveBeenCalledWith({
        current_password: 'old',
        new_password: 'newpassword456',
        new_password_confirmation: 'newpassword456',
      })
      expect(setTokens).toHaveBeenCalledWith('AAA', 'RRR')
    })
  })

  it('shows error when confirmation mismatches (no API call)', async () => {
    render(<PasswordChangeSection />)

    fireEvent.change(screen.getByLabelText('현재 비밀번호'), { target: { value: 'old' } })
    fireEvent.change(screen.getByLabelText('새 비밀번호'), { target: { value: 'newpassword456' } })
    fireEvent.change(screen.getByLabelText('새 비밀번호 확인'), { target: { value: 'mismatch' } })
    fireEvent.click(screen.getByRole('button', { name: '비밀번호 변경' }))

    expect(await screen.findByText('새 비밀번호가 일치하지 않습니다.')).toBeInTheDocument()
    expect(changePassword).not.toHaveBeenCalled()
  })
})
