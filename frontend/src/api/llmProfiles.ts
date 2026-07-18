import apiClient from './client'

export interface LlmProfile {
  id: number
  name: string
  preset_id: string
  provider: string
  base_url: string | null
  model: string | null
  max_input_tokens: number | null
  max_output_tokens: number | null
  has_token: boolean
  auth_token_masked: string | null
}

export type LlmProfileScope = 'personal' | 'server'

export interface LlmProfileParams {
  name: string
  preset_id: string
  provider: string
  base_url?: string
  model?: string
  auth_token?: string
  max_input_tokens?: number
  max_output_tokens?: number
}

export async function listLlmProfiles(scope: LlmProfileScope = 'personal'): Promise<LlmProfile[]> {
  const res = await apiClient.get('llm_profiles', { searchParams: { scope } }).json<{ profiles: LlmProfile[] }>()
  return res.profiles
}

export async function createLlmProfile(scope: LlmProfileScope, params: LlmProfileParams): Promise<LlmProfile> {
  const res = await apiClient.post('llm_profiles', { searchParams: { scope }, json: { profile: params } }).json<{ profile: LlmProfile }>()
  return res.profile
}

export async function updateLlmProfile(id: number, params: Partial<LlmProfileParams>): Promise<LlmProfile> {
  const res = await apiClient.patch(`llm_profiles/${id}`, { json: { profile: params } }).json<{ profile: LlmProfile }>()
  return res.profile
}

export async function deleteLlmProfile(id: number): Promise<void> {
  await apiClient.delete(`llm_profiles/${id}`)
}
