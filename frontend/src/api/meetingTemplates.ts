import apiClient from './client'

export interface MeetingTemplate {
  id: number
  name: string
  meeting_type: string | null
  folder_id: number | null
  settings_json: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface MeetingTemplateParams {
  name: string
  meeting_type?: string
  folder_id?: number | null
  settings_json?: Record<string, unknown>
}

export async function getMeetingTemplates(): Promise<MeetingTemplate[]> {
  return apiClient.get('meeting_templates').json()
}

export async function createMeetingTemplate(data: MeetingTemplateParams): Promise<MeetingTemplate> {
  return apiClient.post('meeting_templates', { json: data }).json()
}

export async function updateMeetingTemplate(id: number, data: Partial<MeetingTemplateParams>): Promise<MeetingTemplate> {
  return apiClient.put(`meeting_templates/${id}`, { json: data }).json()
}

export async function deleteMeetingTemplate(id: number): Promise<void> {
  await apiClient.delete(`meeting_templates/${id}`)
}
