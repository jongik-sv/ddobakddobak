import apiClient from './client'

export interface UserLlmSettingsResponse {
  llm_settings: {
    provider: string | null
    api_key_masked: string | null
    model: string | null
    base_url: string | null
    configured: boolean
    enabled: boolean
    has_settings: boolean
  }
  server_default: {
    provider: string | null
    model: string | null
    has_key: boolean
  }
}

export interface UserLlmSettingsUpdateParams {
  llm_settings: {
    provider: string
    api_key?: string
    model?: string
    base_url?: string | null
  }
}

export interface UserLlmTestParams {
  provider: string
  model: string
  api_key?: string
  base_url?: string
}

export interface UserLlmTestResult {
  success: boolean
  error?: string
  message?: string
  response_time_ms?: number
}

export async function getUserLlmSettings(): Promise<UserLlmSettingsResponse> {
  return apiClient.get('user/llm_settings').json()
}

export async function updateUserLlmSettings(
  params: UserLlmSettingsUpdateParams
): Promise<UserLlmSettingsResponse> {
  return apiClient.put('user/llm_settings', { json: params }).json()
}

export async function testUserLlmConnection(
  params: UserLlmTestParams
): Promise<UserLlmTestResult> {
  return apiClient.post('user/llm_settings/test', { json: params }).json()
}

export async function toggleUserLlm(): Promise<UserLlmSettingsResponse> {
  return apiClient.patch('user/llm_settings/toggle', { json: {} }).json()
}
