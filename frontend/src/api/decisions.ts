import apiClient from './client'

export interface Decision {
  id: number
  content: string
  context: string | null
  decided_at: string | null
  participants: string | null
  status: 'active' | 'revised' | 'cancelled'
  ai_generated: boolean
  created_at: string
}

export interface CreateDecisionParams {
  content: string
  context?: string | null
  decided_at?: string | null
  participants?: string | null
  status?: Decision['status']
}

export interface UpdateDecisionParams {
  content?: string
  context?: string | null
  decided_at?: string | null
  participants?: string | null
  status?: Decision['status']
}

export async function getDecisions(meetingId: number): Promise<Decision[]> {
  return apiClient.get(`meetings/${meetingId}/decisions`).json()
}

export async function createDecision(
  meetingId: number,
  params: CreateDecisionParams
): Promise<Decision> {
  return apiClient
    .post(`meetings/${meetingId}/decisions`, { json: { decision: params } })
    .json()
}

export async function updateDecision(
  id: number,
  params: UpdateDecisionParams
): Promise<Decision> {
  return apiClient
    .patch(`decisions/${id}`, { json: { decision: params } })
    .json()
}

export async function deleteDecision(id: number): Promise<void> {
  await apiClient.delete(`decisions/${id}`)
}

export async function getDecisionTimeline(folderId?: number): Promise<Decision[]> {
  const searchParams = folderId ? `?folder_id=${folderId}` : ''
  return apiClient.get(`decisions${searchParams}`).json()
}
