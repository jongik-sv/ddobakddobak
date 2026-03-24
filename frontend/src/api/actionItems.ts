import apiClient from './client'

export interface ActionItemAssignee {
  id: number
  name: string
}

export interface ActionItem {
  id: number
  content: string
  status: 'todo' | 'in_progress' | 'done'
  due_date: string | null
  ai_generated: boolean
  assignee: ActionItemAssignee | null
  created_at: string
}

export interface CreateActionItemParams {
  content: string
  assignee_id?: number | null
  due_date?: string | null
  status?: ActionItem['status']
}

export interface UpdateActionItemParams {
  assignee_id?: number | null
  due_date?: string | null
  status?: ActionItem['status']
  content?: string
}

export async function getActionItems(meetingId: number): Promise<ActionItem[]> {
  return apiClient.get(`meetings/${meetingId}/action_items`).json()
}

export async function createActionItem(
  meetingId: number,
  params: CreateActionItemParams
): Promise<ActionItem> {
  return apiClient
    .post(`meetings/${meetingId}/action_items`, { json: { action_item: params } })
    .json()
}

export async function updateActionItem(
  id: number,
  params: UpdateActionItemParams
): Promise<ActionItem> {
  return apiClient
    .patch(`action_items/${id}`, { json: { action_item: params } })
    .json()
}

export async function deleteActionItem(id: number): Promise<void> {
  await apiClient.delete(`action_items/${id}`)
}
