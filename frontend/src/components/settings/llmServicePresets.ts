import { fetchOllamaModels, fetchLmStudioModels } from '../../api/settings'

export interface ServicePreset {
  id: string
  name: string
  provider: string
  defaultBaseUrl: string
  requiresApiKey: boolean
  suggestedModels: readonly string[]
  description: string
}

export const SERVICE_PRESETS: readonly ServicePreset[] = [
  { id: 'claude_cli', name: 'Claude Code', provider: 'claude_cli', defaultBaseUrl: '', requiresApiKey: false, suggestedModels: ['sonnet', 'opus', 'haiku'], description: 'Claude Code CLI (키 불필요)' },
  { id: 'gemini_cli', name: 'Antigravity CLI', provider: 'gemini_cli', defaultBaseUrl: '', requiresApiKey: false, suggestedModels: ['Gemini 3.5 Flash (Medium)', 'Gemini 3.5 Flash (High)', 'Gemini 3.5 Flash (Low)', 'Gemini 3.1 Pro (Low)', 'Gemini 3.1 Pro (High)', 'Claude Sonnet 4.6 (Thinking)', 'Claude Opus 4.6 (Thinking)', 'GPT-OSS 120B (Medium)'], description: 'Antigravity CLI(agy) — Gemini CLI 후속. agy models 기준' },
  { id: 'codex_cli', name: 'Codex CLI', provider: 'codex_cli', defaultBaseUrl: '', requiresApiKey: false, suggestedModels: ['gpt-5.5', 'gpt-5.4-mini'], description: 'Codex CLI (키 불필요)' },
  { id: 'anthropic', name: 'Anthropic', provider: 'anthropic', defaultBaseUrl: '', requiresApiKey: true, suggestedModels: ['claude-sonnet-5', 'claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5'], description: 'Claude API (키 필요)' },
  { id: 'zai', name: 'Z.AI', provider: 'anthropic', defaultBaseUrl: 'https://api.z.ai/api/anthropic', requiresApiKey: true, suggestedModels: ['glm-5.2', 'glm-5.1', 'glm-5-turbo', 'glm-5v-turbo', 'glm-4.7', 'glm-4.5-air'], description: 'GLM 모델 (Anthropic 호환)' },
  { id: 'openai', name: 'OpenAI', provider: 'openai', defaultBaseUrl: '', requiresApiKey: true, suggestedModels: ['gpt-4o', 'gpt-4o-mini'], description: 'GPT 모델 (키 필요)' },
  { id: 'ollama', name: 'Ollama', provider: 'openai', defaultBaseUrl: 'http://localhost:11434/v1', requiresApiKey: false, suggestedModels: [], description: '로컬 실행 (키 불필요)' },
  { id: 'lmstudio', name: 'LM Studio', provider: 'openai', defaultBaseUrl: 'http://localhost:1234/v1', requiresApiKey: false, suggestedModels: [], description: '로컬 실행 (키 불필요)' },
  { id: 'custom', name: '직접 입력', provider: 'openai', defaultBaseUrl: '', requiresApiKey: true, suggestedModels: [], description: '호환 API 직접 설정' },
]

export const LOCAL_MODEL_FETCHERS: Record<string, (baseUrl: string) => Promise<string[]>> = {
  ollama: fetchOllamaModels,
  lmstudio: fetchLmStudioModels,
}

export const isLocalListable = (presetId: string): boolean => presetId in LOCAL_MODEL_FETCHERS

/**
 * 클라우드 프로바이더(anthropic/openai 계열, 로컬 제외) 여부 — provider `/v1/models` 원격 조회 대상.
 * anthropic·zai·openai·custom = true / ollama·lmstudio(로컬)·CLI·none = false.
 * 로컬은 브라우저가 직접 조회(LOCAL_MODEL_FETCHERS)하므로 클라우드 대상에서 뺀다.
 */
export function isCloudListable(presetId: string): boolean {
  if (presetId in LOCAL_MODEL_FETCHERS) return false
  const p = SERVICE_PRESETS.find((x) => x.id === presetId)
  return !!p && (p.provider === 'anthropic' || p.provider === 'openai')
}

/** 프리셋 선택 시 폼 기본값(base_url/model/auth_token). 알 수 없는 id면 빈 폼. */
export function presetFormDefaults(id: string): { base_url: string; model: string; auth_token: string } {
  const p = SERVICE_PRESETS.find((x) => x.id === id)
  return { base_url: p?.defaultBaseUrl ?? '', model: p?.suggestedModels[0] ?? '', auth_token: '' }
}

export const CLI_PRESET_IDS = new Set<string>(
  SERVICE_PRESETS.filter((p) => !p.requiresApiKey && !p.defaultBaseUrl).map((p) => p.id),
)

/** 개인 설정의 (provider, base_url) 저장값 → 프리셋 id 역매핑. 빈 provider면 null(호출자가 none 센티넬 결정). */
export function presetIdFromUserConfig(provider: string | null, baseUrl: string | null): string | null {
  if (!provider) return null
  // 'server' = 챗을 서버 모델로 강제하는 센티넬(실제 프로바이더 아님). AI 챗 카드의 '서버 모델' 옵션.
  if (provider === 'server') return 'server'
  if (provider === 'claude_cli' || provider === 'gemini_cli' || provider === 'codex_cli') return provider
  const b = (baseUrl ?? '').trim()
  if (provider === 'anthropic') {
    if (!b) return 'anthropic'
    return b.includes('z.ai') ? 'zai' : 'anthropic'
  }
  if (provider === 'openai') {
    if (!b) return 'openai'
    if (b.includes('11434')) return 'ollama'
    if (b.includes('1234')) return 'lmstudio'
    return 'custom'
  }
  return 'anthropic'
}
