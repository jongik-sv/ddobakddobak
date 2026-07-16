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
    chat_provider?: string | null
    chat_model?: string | null
    chat_base_url?: string | null
    chat_api_key_masked?: string | null
    chat_configured?: boolean
    // 4-tier 카스케이드로 실제 답변할 모델의 표시명(폴더챗 미리보기용).
    effective_chat_model?: string | null
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
    chat_provider?: string | null
    chat_api_key?: string
    chat_model?: string | null
    chat_base_url?: string | null
    // true 면 요약·챗 전체 초기화. 생략/false 면 요약만 비우고 챗 설정은 보존.
    reset_all?: boolean
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

// 클라우드 프로바이더(anthropic/openai)의 모델 목록을 백엔드 프록시로 조회한다('모델 새로고침').
// api_key 미전송 시 서버가 저장된 개인 키로 폴백. 서버가 error 를 담아 응답하면 throw 하여
// 카드가 폴백(추천 목록) + 에러 메시지를 표시하게 한다.
export async function fetchUserLlmModels(params: {
  provider: string
  base_url?: string | null
  api_key?: string
}): Promise<string[]> {
  const res = await apiClient
    .post('user/llm_settings/models', { json: params })
    .json<{ models?: string[]; error?: string }>()
  if (res.error) throw new Error(res.error)
  return res.models ?? []
}
