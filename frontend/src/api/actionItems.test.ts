import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getActionItems, createActionItem, updateActionItem, deleteActionItem } from './actionItems'

const { mockJson, mockGet, mockPost, mockPatch, mockDelete } = vi.hoisted(() => {
  const mockJson = vi.fn()
  const mockGet = vi.fn(() => ({ json: mockJson }))
  const mockPost = vi.fn(() => ({ json: mockJson }))
  const mockPatch = vi.fn(() => ({ json: mockJson }))
  const mockDelete = vi.fn(() => Promise.resolve())
  return { mockJson, mockGet, mockPost, mockPatch, mockDelete }
})

vi.mock('./client', () => ({
  default: {
    get: mockGet,
    post: mockPost,
    patch: mockPatch,
    delete: mockDelete,
  },
}))

const mockItem = {
  id: 1,
  content: '테스트 할 일',
  status: 'todo' as const,
  due_date: null,
  ai_generated: false,
  assignee: null,
  created_at: '2026-03-25T00:00:00Z',
}

describe('actionItems API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockReturnValue({ json: mockJson })
    mockPost.mockReturnValue({ json: mockJson })
    mockPatch.mockReturnValue({ json: mockJson })
    mockDelete.mockResolvedValue(undefined)
  })

  describe('getActionItems', () => {
    it('meetings/:id/action_items로 GET 요청', async () => {
      mockJson.mockResolvedValue([mockItem])
      await getActionItems(42)
      expect(mockGet).toHaveBeenCalledWith('meetings/42/action_items')
    })

    it('ActionItem 배열 반환', async () => {
      mockJson.mockResolvedValue([mockItem])
      const result = await getActionItems(42)
      expect(result).toEqual([mockItem])
    })
  })

  describe('createActionItem', () => {
    it('meetings/:id/action_items로 POST 요청', async () => {
      mockJson.mockResolvedValue(mockItem)
      await createActionItem(42, { content: '새 할 일' })
      expect(mockPost).toHaveBeenCalledWith('meetings/42/action_items', {
        json: { action_item: { content: '새 할 일' } },
      })
    })

    it('생성된 ActionItem 반환', async () => {
      mockJson.mockResolvedValue(mockItem)
      const result = await createActionItem(42, { content: '새 할 일' })
      expect(result).toEqual(mockItem)
    })

    it('assignee_id, due_date 포함해서 POST 요청', async () => {
      mockJson.mockResolvedValue(mockItem)
      await createActionItem(42, { content: '할 일', assignee_id: 5, due_date: '2026-04-01' })
      expect(mockPost).toHaveBeenCalledWith('meetings/42/action_items', {
        json: { action_item: { content: '할 일', assignee_id: 5, due_date: '2026-04-01' } },
      })
    })
  })

  describe('updateActionItem', () => {
    it('action_items/:id로 PATCH 요청', async () => {
      mockJson.mockResolvedValue({ ...mockItem, status: 'done' })
      await updateActionItem(1, { status: 'done' })
      expect(mockPatch).toHaveBeenCalledWith('action_items/1', {
        json: { action_item: { status: 'done' } },
      })
    })

    it('업데이트된 ActionItem 반환', async () => {
      const updatedItem = { ...mockItem, status: 'done' as const }
      mockJson.mockResolvedValue(updatedItem)
      const result = await updateActionItem(1, { status: 'done' })
      expect(result.status).toBe('done')
    })
  })

  describe('deleteActionItem', () => {
    it('action_items/:id로 DELETE 요청', async () => {
      await deleteActionItem(1)
      expect(mockDelete).toHaveBeenCalledWith('action_items/1')
    })
  })
})
