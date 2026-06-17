import { describe, it, expect, vi, beforeEach } from 'vitest'
import { moveMeetingsToProject } from '../meetings'
import { moveFolderToProject } from '../folders'
import apiClient from '../client'

vi.mock('../client', () => ({
  default: { post: vi.fn(() => ({ json: () => Promise.resolve({}) })) },
  getAuthHeaders: vi.fn(() => ({})),
}))

describe('move to project API', () => {
  beforeEach(() => vi.clearAllMocks())

  it('moveMeetingsToProject는 meeting_ids+target_project_id를 POST', async () => {
    await moveMeetingsToProject([1, 2], 9)
    expect(apiClient.post).toHaveBeenCalledWith('meetings/move_to_project', {
      json: { meeting_ids: [1, 2], target_project_id: 9 },
    })
  })

  it('moveFolderToProject는 folder id 경로 + target_project_id를 POST', async () => {
    await moveFolderToProject(5, 9)
    expect(apiClient.post).toHaveBeenCalledWith('folders/5/move_to_project', {
      json: { target_project_id: 9 },
    })
  })
})
