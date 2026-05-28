import { describe, it, expect, vi, beforeEach } from 'vitest'

const patch = vi.fn()
vi.mock('./client', () => ({
  default: { patch: (...a: unknown[]) => patch(...a) },
}))

import { changePassword } from './account'

beforeEach(() => patch.mockReset())

describe('changePassword', () => {
  it('PATCHes user/password and returns new tokens', async () => {
    patch.mockReturnValue({
      json: () => Promise.resolve({ access_token: 'AAA', refresh_token: 'RRR' }),
    })

    const result = await changePassword({
      current_password: 'old',
      new_password: 'newpassword456',
      new_password_confirmation: 'newpassword456',
    })

    expect(patch).toHaveBeenCalledWith('user/password', {
      json: {
        current_password: 'old',
        new_password: 'newpassword456',
        new_password_confirmation: 'newpassword456',
      },
    })
    expect(result).toEqual({ access_token: 'AAA', refresh_token: 'RRR' })
  })
})
