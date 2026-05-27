import { describe, it, expect, vi, beforeEach } from 'vitest'

const post = vi.fn()
const put = vi.fn()
vi.mock('./client', () => ({
  default: { post: (...a: unknown[]) => post(...a), put: (...a: unknown[]) => put(...a) },
}))

import { resetAdminUserPassword, updateAdminUser } from './adminUsers'

beforeEach(() => {
  post.mockReset()
  put.mockReset()
})

describe('resetAdminUserPassword', () => {
  it('POSTs to reset_password and returns temp_password', async () => {
    post.mockReturnValue({ json: () => Promise.resolve({ temp_password: 'abc123XYZ789' }) })

    const result = await resetAdminUserPassword(42)

    expect(post).toHaveBeenCalledWith('admin/users/42/reset_password')
    expect(result.temp_password).toBe('abc123XYZ789')
  })
})

describe('updateAdminUser', () => {
  it('sends email when provided', async () => {
    put.mockReturnValue({ json: () => Promise.resolve({ user: { id: 1, email: 'new@x.com', name: 'A', role: 'member', created_at: '', updated_at: '' } }) })

    await updateAdminUser(1, { email: 'new@x.com' })

    expect(put).toHaveBeenCalledWith('admin/users/1', { json: { email: 'new@x.com' } })
  })
})
