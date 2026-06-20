import { describe, it, expect } from 'vitest'
import { SERVICE_PRESETS, CLI_PRESET_IDS, isLocalListable, presetIdFromUserConfig } from './llmServicePresets'

describe('llmServicePresets', () => {
  it('8개 프리셋 + zai glm-5.2 보유', () => {
    const ids = SERVICE_PRESETS.map((p) => p.id)
    expect(ids).toEqual(['claude_cli', 'gemini_cli', 'codex_cli', 'anthropic', 'zai', 'openai', 'ollama', 'lmstudio', 'custom'])
    expect(SERVICE_PRESETS.find((p) => p.id === 'zai')!.suggestedModels).toContain('glm-5.2')
    expect(SERVICE_PRESETS.find((p) => p.id === 'zai')!.provider).toBe('anthropic')
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
    expect(presetIdFromUserConfig('openai', '')).toBe('openai')
    expect(presetIdFromUserConfig('openai', 'http://localhost:11434/v1')).toBe('ollama')
    expect(presetIdFromUserConfig('openai', 'http://localhost:1234/v1')).toBe('lmstudio')
    expect(presetIdFromUserConfig('openai', 'http://my-server:8000/v1')).toBe('custom')
  })
})
