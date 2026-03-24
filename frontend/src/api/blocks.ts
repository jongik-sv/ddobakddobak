import apiClient from './client'

export interface ApiBlock {
  id: number
  meeting_id: number
  block_type: string
  content: string
  position: number
  parent_block_id: number | null
  created_at: string
  updated_at: string
}

export interface ReorderResponse {
  block: ApiBlock
  rebalanced: boolean
  blocks?: ApiBlock[]
}

// GET /api/v1/meetings/:meeting_id/blocks
export async function getBlocks(meetingId: number): Promise<ApiBlock[]> {
  return apiClient.get(`meetings/${meetingId}/blocks`).json()
}

// POST /api/v1/meetings/:meeting_id/blocks
export async function createBlock(
  meetingId: number,
  payload: {
    block_type: string
    content: string
    position: number
    parent_block_id: number | null
  }
): Promise<ApiBlock> {
  return apiClient
    .post(`meetings/${meetingId}/blocks`, { json: payload })
    .json()
}

// PATCH /api/v1/meetings/:meeting_id/blocks/:id
export async function updateBlock(
  meetingId: number,
  blockId: number,
  payload: Partial<{ block_type: string; content: string }>
): Promise<ApiBlock> {
  return apiClient
    .patch(`meetings/${meetingId}/blocks/${blockId}`, { json: payload })
    .json()
}

// DELETE /api/v1/meetings/:meeting_id/blocks/:id
export async function deleteBlock(meetingId: number, blockId: number): Promise<void> {
  await apiClient.delete(`meetings/${meetingId}/blocks/${blockId}`)
}

// PATCH /api/v1/meetings/:meeting_id/blocks/:id/reorder
export async function reorderBlock(
  meetingId: number,
  blockId: number,
  payload: { prev_block_id: number | null; next_block_id: number | null }
): Promise<ReorderResponse> {
  return apiClient
    .patch(`meetings/${meetingId}/blocks/${blockId}/reorder`, { json: payload })
    .json()
}
