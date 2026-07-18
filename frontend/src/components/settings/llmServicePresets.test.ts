import { describe, it, expect } from 'vitest'
import { SERVICE_PRESETS, CLI_PRESET_IDS, PROFILE_PRESETS, CLI_PRESETS, isLocalListable, presetIdFromUserConfig } from './llmServicePresets'

describe('llmServicePresets', () => {
  it('10개 프리셋 + zai glm-5.2 보유', () => {
    const ids = SERVICE_PRESETS.map((p) => p.id)
    expect(ids).toEqual(['claude_cli', 'gemini_cli', 'codex_cli', 'anthropic', 'zai', 'gemini', 'openai', 'ollama', 'lmstudio', 'custom'])
    expect(SERVICE_PRESETS.find((p) => p.id === 'zai')!.suggestedModels).toContain('glm-5.2')
    expect(SERVICE_PRESETS.find((p) => p.id === 'zai')!.provider).toBe('anthropic')
  })
  it('gemini 프리셋 — OpenAI 호환·키 필요·발급 링크', () => {
    const g = SERVICE_PRESETS.find((p) => p.id === 'gemini')!
    expect(g.provider).toBe('openai')
    expect(g.defaultBaseUrl).toBe('https://generativelanguage.googleapis.com/v1beta/openai')
    expect(g.requiresApiKey).toBe(true)
    expect(g.suggestedModels[0]).toBe('gemini-3.5-flash')
    expect(g.apiKeyUrl).toBe('https://aistudio.google.com/app/apikey')
  })
  it('키 필요 프리셋 4종은 apiKeyUrl 보유', () => {
    for (const id of ['anthropic', 'openai', 'gemini', 'zai']) {
      expect(SERVICE_PRESETS.find((p) => p.id === id)?.apiKeyUrl).toBeTruthy()
    }
  })
  it('presetIdFromUserConfig — generativelanguage URL은 gemini', () => {
    expect(presetIdFromUserConfig('openai', 'https://generativelanguage.googleapis.com/v1beta/openai')).toBe('gemini')
  })
  it('PROFILE_PRESETS는 CLI 제외, CLI_PRESETS는 CLI만', () => {
    expect(PROFILE_PRESETS.map((p) => p.id)).toEqual(['anthropic', 'zai', 'gemini', 'openai', 'ollama', 'lmstudio', 'custom'])
    expect(CLI_PRESETS.map((p) => p.id)).toEqual(['claude_cli', 'gemini_cli', 'codex_cli'])
  })
  it('CLI 프리셋 3개 식별(키불요+base없음)', () => {
    expect([...CLI_PRESET_IDS].sort()).toEqual(['claude_cli', 'codex_cli', 'gemini_cli'])
  })
  it('ollama/lmstudio는 로컬 목록 대상', () => {
    expect(isLocalListable('ollama')).toBe(true)
    expect(isLocalListable('lmstudio')).toBe(true)
    expect(isLocalListable('anthropic')).toBe(false)
  })
  it('presetIdFromUserConfig 역매핑', () => {
    expect(presetIdFromUserConfig(null, null)).toBeNull()
    expect(presetIdFromUserConfig('', '')).toBeNull()
    expect(presetIdFromUserConfig('claude_cli', '')).toBe('claude_cli')
    expect(presetIdFromUserConfig('gemini_cli', '')).toBe('gemini_cli')
    expect(presetIdFromUserConfig('codex_cli', '')).toBe('codex_cli')
    expect(presetIdFromUserConfig('anthropic', null)).toBe('anthropic')
    expect(presetIdFromUserConfig('anthropic', 'https://api.z.ai/api/anthropic')).toBe('zai')
    expect(presetIdFromUserConfig('anthropic', 'https://my-proxy.example/anthropic')).toBe('anthropic')
    expect(presetIdFromUserConfig('openai', '')).toBe('openai')
    expect(presetIdFromUserConfig('openai', 'http://localhost:11434/v1')).toBe('ollama')
    expect(presetIdFromUserConfig('openai', 'http://localhost:1234/v1')).toBe('lmstudio')
    expect(presetIdFromUserConfig('openai', 'http://my-server:8000/v1')).toBe('custom')
  })
})
