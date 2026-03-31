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
  provider: string
  auth_token_masked: string
  anthropic_token_masked?: string
  openai_token_masked?: string
  base_url: string
  model: string
  max_input_tokens: number
  max_output_tokens: number
  offline?: boolean
}

export async function getLlmSettings(): Promise<LlmSettings> {
  return apiClient.get('settings/llm').json()
}

export async function updateLlmSettings(params: {
  provider?: string
  auth_token?: string
  base_url?: string
  model?: string
  max_input_tokens?: number
  max_output_tokens?: number
}): Promise<LlmSettings> {
  return apiClient.put('settings/llm', { json: params }).json()
}

export async function testLlmConnection(params: {
  provider: string
  auth_token?: string
  base_url?: string
  model: string
}): Promise<{ success: boolean; error?: string }> {
  return apiClient.post('settings/llm/test', { json: params }).json()
}

export async function fetchOllamaModels(baseUrl: string): Promise<string[]> {
  const ollamaUrl = baseUrl.replace(/\/v1\/?$/, '')
  const res = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) })
  if (!res.ok) return []
  const data = await res.json()
  return (data.models ?? []).map((m: { name: string }) => m.name)
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

// 앱 설정 (.env 기반)
export interface AppSettings {
  summary_interval_sec?: number
  diarization_enabled?: boolean
  selected_languages?: string[]
  audio_silence_threshold?: number
  audio_speech_threshold?: number
  audio_silence_duration_ms?: number
  audio_max_chunk_sec?: number
  audio_min_chunk_sec?: number
  audio_preroll_ms?: number
  audio_overlap_ms?: number
  audio_file_chunk_sec?: number
  diarization_similarity_threshold?: number
  diarization_merge_threshold?: number
  diarization_max_embeddings_per_speaker?: number
}

export async function getAppSettings(): Promise<AppSettings> {
  return apiClient.get('settings/app').json()
}

export async function updateAppSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
  return apiClient.put('settings/app', { json: settings }).json()
}
