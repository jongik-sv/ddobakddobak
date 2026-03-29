import apiClient from './client'

export interface PromptTemplate {
  id: number
  meeting_type: string
  label: string
  sections_prompt: string
  is_default: boolean
  created_at: string
  updated_at: string
}

export async function getPromptTemplates(): Promise<PromptTemplate[]> {
  return apiClient.get('prompt_templates').json()
}

export async function createPromptTemplate(data: {
  meeting_type: string
  label: string
  sections_prompt: string
}): Promise<PromptTemplate> {
  return apiClient.post('prompt_templates', { json: data }).json()
}

export async function updatePromptTemplate(
  id: number,
  data: Partial<{ label: string; sections_prompt: string }>
): Promise<PromptTemplate> {
  return apiClient.patch(`prompt_templates/${id}`, { json: data }).json()
}

export async function deletePromptTemplate(id: number): Promise<void> {
  await apiClient.delete(`prompt_templates/${id}`)
}

export async function resetPromptTemplate(id: number): Promise<PromptTemplate> {
  return apiClient.post(`prompt_templates/${id}/reset`).json()
}
