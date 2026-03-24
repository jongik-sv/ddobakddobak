import apiClient from './client'

export interface SttSettings {
  stt_engine: string
  available_engines: string[]
  model_loaded: boolean
}

export async function getSttSettings(): Promise<SttSettings> {
  return apiClient.get('settings').json()
}

export async function updateSttEngine(engine: string): Promise<{ stt_engine: string; model_loaded: boolean }> {
  return apiClient.post('settings/stt_engine', { json: { engine } }).json()
}

// LLM 설정
export interface LlmSettings {
  auth_token_masked: string
  base_url: string
  model: string
  offline?: boolean
}

export async function getLlmSettings(): Promise<LlmSettings> {
  return apiClient.get('settings/llm').json()
}

export async function updateLlmSettings(params: {
  auth_token?: string
  base_url?: string
  model?: string
}): Promise<LlmSettings> {
  return apiClient.put('settings/llm', { json: params }).json()
}

// HuggingFace 설정
export interface HfSettings {
  hf_token_masked: string
  has_token: boolean
  offline?: boolean
}

export async function getHfSettings(): Promise<HfSettings> {
  return apiClient.get('settings/hf').json()
}

export async function updateHfToken(hf_token: string): Promise<HfSettings> {
  return apiClient.put('settings/hf', { json: { hf_token } }).json()
}
