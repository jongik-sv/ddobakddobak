import { describe, it, expect, vi, beforeEach } from 'vitest'

const get = vi.fn()
const post = vi.fn()
const del = vi.fn()
vi.mock('./client', () => ({
  default: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    delete: (...a: unknown[]) => del(...a),
  },
}))

import { listTrash, restoreTrashItem, purgeTrashItem, emptyTrash } from './trash'

beforeEach(() => {
  get.mockReset()
  post.mockReset()
  del.mockReset()
})

describe('listTrash', () => {
  it('GETs /trash and returns the items array', async () => {
    const items = [
      {
        type: 'meeting',
        id: 1,
        title: '회의1',
        deleted_at: '2026-06-18T00:00:00Z',
        deleted_by_id: 1,
        trash_group_id: 'g1',
      },
    ]
    get.mockReturnValue({ json: () => Promise.resolve({ items }) })

    const result = await listTrash()

    expect(get).toHaveBeenCalledWith('trash')
    expect(result).toEqual(items)
  })

  it('falls back to res.data when no items key', async () => {
    const items = [
      {
        type: 'folder',
        id: 2,
        title: '폴더',
        deleted_at: '2026-06-18T00:00:00Z',
        deleted_by_id: 1,
        trash_group_id: 'g2',
      },
    ]
    get.mockReturnValue({ json: () => Promise.resolve(items) })

    const result = await listTrash()

    expect(result).toEqual(items)
  })
})

describe('restoreTrashItem', () => {
  it('POSTs /trash/:type/:id/restore', async () => {
    post.mockReturnValue(Promise.resolve())

    await restoreTrashItem('meeting', 1)

    expect(post).toHaveBeenCalledWith('trash/meeting/1/restore')
  })
})

describe('purgeTrashItem', () => {
  it('DELETEs /trash/:type/:id', async () => {
    del.mockReturnValue(Promise.resolve())

    await purgeTrashItem('meeting', 1)

    expect(del).toHaveBeenCalledWith('trash/meeting/1')
  })
})

describe('emptyTrash', () => {
  it('DELETEs /trash', async () => {
    del.mockReturnValue(Promise.resolve())

    await emptyTrash()

    expect(del).toHaveBeenCalledWith('trash')
  })
})
