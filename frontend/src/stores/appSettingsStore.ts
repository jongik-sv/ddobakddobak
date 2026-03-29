import { create } from 'zustand'
import {
  DEFAULT_SUMMARY_INTERVAL_SEC,
  AUDIO,
  AUDIO_DEFAULTS,
  DIARIZATION_DEFAULTS,
  LANGUAGES,
} from '../config'
import type { DiarizationConfig } from '../config'
import { getAppSettings, updateAppSettings } from '../api/settings'
import type { AppSettings } from '../api/settings'

type AudioOverrides = Partial<{
  silence_threshold: number
  speech_threshold: number
  silence_duration_ms: number
  max_chunk_sec: number
  min_chunk_sec: number
  preroll_ms: number
  overlap_ms: number
}>

type DiarizationOverrides = Partial<DiarizationConfig>

interface AppSettingsState {
  /** AI 회의록 적용 주기 (초) */
  summaryIntervalSec: number
  setSummaryIntervalSec: (sec: number) => void

  /** 오디오 청킹 오버라이드 (빈 객체 = config.yaml 기본값 사용) */
  audioOverrides: AudioOverrides
  setAudioOverride: (key: keyof AudioOverrides, value: number) => void
  resetAudioOverrides: () => void

  /** 화자 분리 활성화 여부 */
  diarizationEnabled: boolean
  setDiarizationEnabled: (enabled: boolean) => void

  /** 화자 분리 오버라이드 */
  diarizationOverrides: DiarizationOverrides
  setDiarizationOverride: (key: keyof DiarizationOverrides, value: number) => void
  resetDiarizationOverrides: () => void

  /** 선택된 회의 언어 코드 목록 (예: ['ko', 'en']) */
  selectedLanguages: string[]
  toggleLanguage: (code: string) => void
}

// ── .env 동기화 (debounced) ────────────────────────
let saveTimer: ReturnType<typeof setTimeout> | null = null

function debouncedSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const s = useAppSettingsStore.getState()
    const payload: Partial<AppSettings> = {
      summary_interval_sec: s.summaryIntervalSec,
      diarization_enabled: s.diarizationEnabled,
      selected_languages: s.selectedLanguages,
    }
    // 오디오: 오버라이드된 값만 전송, 기본값이면 전송하지 않음
    const audioKeys = ['silence_threshold', 'speech_threshold', 'silence_duration_ms', 'max_chunk_sec', 'min_chunk_sec', 'preroll_ms', 'overlap_ms'] as const
    for (const key of audioKeys) {
      const val = s.audioOverrides[key]
      const envKey = `audio_${key}` as keyof AppSettings
      if (val != null) {
        (payload as Record<string, unknown>)[envKey] = val
      } else {
        // 기본값을 명시적으로 저장 (reset 시)
        (payload as Record<string, unknown>)[envKey] = AUDIO_DEFAULTS[key]
      }
    }
    const diarKeys = ['similarity_threshold', 'merge_threshold', 'max_embeddings_per_speaker'] as const
    for (const key of diarKeys) {
      const val = s.diarizationOverrides[key]
      const envKey = `diarization_${key}` as keyof AppSettings
      if (val != null) {
        (payload as Record<string, unknown>)[envKey] = val
      } else {
        (payload as Record<string, unknown>)[envKey] = DIARIZATION_DEFAULTS[key]
      }
    }
    updateAppSettings(payload).catch(() => {})
  }, 500)
}

export const useAppSettingsStore = create<AppSettingsState>()(
  (set) => ({
    summaryIntervalSec: DEFAULT_SUMMARY_INTERVAL_SEC,
    setSummaryIntervalSec: (sec) => { set({ summaryIntervalSec: sec }); debouncedSave() },

    audioOverrides: {},
    setAudioOverride: (key, value) => {
      set((s) => ({ audioOverrides: { ...s.audioOverrides, [key]: value } }))
      debouncedSave()
    },
    resetAudioOverrides: () => { set({ audioOverrides: {} }); debouncedSave() },

    diarizationEnabled: true,
    setDiarizationEnabled: (enabled) => { set({ diarizationEnabled: enabled }); debouncedSave() },

    diarizationOverrides: {},
    setDiarizationOverride: (key, value) => {
      set((s) => ({ diarizationOverrides: { ...s.diarizationOverrides, [key]: value } }))
      debouncedSave()
    },
    resetDiarizationOverrides: () => { set({ diarizationOverrides: {} }); debouncedSave() },

    selectedLanguages: [LANGUAGES[0]?.code ?? 'ko'],
    toggleLanguage: (code) => {
      set((s) => {
        const current = s.selectedLanguages
        if (current.includes(code)) {
          if (current.length <= 1) return s
          return { selectedLanguages: current.filter((c) => c !== code) }
        }
        return { selectedLanguages: [...current, code] }
      })
      debouncedSave()
    },
  }),
)

/** 앱 시작 시 .env에서 저장된 설정을 로드한다 */
export async function loadAppSettings() {
  try {
    const saved = await getAppSettings()
    const updates: Partial<AppSettingsState> = {}

    if (saved.summary_interval_sec != null) updates.summaryIntervalSec = saved.summary_interval_sec
    if (saved.diarization_enabled != null) updates.diarizationEnabled = saved.diarization_enabled
    if (saved.selected_languages?.length) updates.selectedLanguages = saved.selected_languages

    // 오디오 오버라이드: .env 값이 config.yaml 기본값과 다르면 오버라이드로 설정
    const audioOverrides: AudioOverrides = {}
    const audioMap = {
      audio_silence_threshold: 'silence_threshold',
      audio_speech_threshold: 'speech_threshold',
      audio_silence_duration_ms: 'silence_duration_ms',
      audio_max_chunk_sec: 'max_chunk_sec',
      audio_min_chunk_sec: 'min_chunk_sec',
      audio_preroll_ms: 'preroll_ms',
      audio_overlap_ms: 'overlap_ms',
    } as const
    for (const [envKey, storeKey] of Object.entries(audioMap)) {
      const val = saved[envKey as keyof AppSettings] as number | undefined
      if (val != null && val !== AUDIO_DEFAULTS[storeKey as keyof typeof AUDIO_DEFAULTS]) {
        (audioOverrides as Record<string, number>)[storeKey] = val
      }
    }
    if (Object.keys(audioOverrides).length > 0) updates.audioOverrides = audioOverrides

    // 화자분리 오버라이드
    const diarOverrides: DiarizationOverrides = {}
    const diarMap = {
      diarization_similarity_threshold: 'similarity_threshold',
      diarization_merge_threshold: 'merge_threshold',
      diarization_max_embeddings_per_speaker: 'max_embeddings_per_speaker',
    } as const
    for (const [envKey, storeKey] of Object.entries(diarMap)) {
      const val = saved[envKey as keyof AppSettings] as number | undefined
      if (val != null && val !== DIARIZATION_DEFAULTS[storeKey as keyof typeof DIARIZATION_DEFAULTS]) {
        (diarOverrides as Record<string, number>)[storeKey] = val
      }
    }
    if (Object.keys(diarOverrides).length > 0) updates.diarizationOverrides = diarOverrides

    if (Object.keys(updates).length > 0) {
      useAppSettingsStore.setState(updates)
    }
  } catch {
    // API 연결 실패 시 기본값 사용
  }
}

/** config.yaml 기본값 + 사용자 오버라이드를 병합한 오디오 설정 반환 */
export function getEffectiveAudioConfig() {
  const overrides = useAppSettingsStore.getState().audioOverrides
  return { ...AUDIO, ...overrides }
}

export { AUDIO_DEFAULTS, DIARIZATION_DEFAULTS }
