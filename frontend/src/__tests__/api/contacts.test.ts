import { describe, it, expect, vi, beforeEach } from 'vitest'

const { get, patch, del } = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), del: vi.fn() }))
vi.mock('ky', () => {
  const instance = { get, post: vi.fn(), patch, delete: del }
  return { default: { create: vi.fn(() => instance) }, __esModule: true }
})

describe('contacts API', () => {
  beforeEach(() => {
    get.mockReset(); patch.mockReset(); del.mockReset()
  })

  it('getContacts returns the contacts array', async () => {
    get.mockReturnValue({ json: () => Promise.resolve({ contacts: [{ id: 1, name: '홍길동' }] }) })
    const { getContacts } = await import('../../api/contacts')
    const result = await getContacts(7)
    expect(get).toHaveBeenCalledWith('meetings/7/contacts')
    expect(result).toEqual([{ id: 1, name: '홍길동' }])
  })

  it('updateContact PATCHes and returns the contact', async () => {
    patch.mockReturnValue({ json: () => Promise.resolve({ contact: { id: 1, name: '정정' } }) })
    const { updateContact } = await import('../../api/contacts')
    const result = await updateContact(7, 1, { name: '정정' })
    expect(patch).toHaveBeenCalledWith('meetings/7/contacts/1', { json: { name: '정정' } })
    expect(result).toEqual({ id: 1, name: '정정' })
  })

  it('deleteContact DELETEs', async () => {
    del.mockReturnValue({ json: () => Promise.resolve({}) })
    const { deleteContact } = await import('../../api/contacts')
    await deleteContact(7, 1)
    expect(del).toHaveBeenCalledWith('meetings/7/contacts/1')
  })
})
