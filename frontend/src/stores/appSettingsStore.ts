import { create } from 'zustand'
import {
  AUDIO,
  AUDIO_DEFAULTS,
  DIARIZATION_DEFAULTS,
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
  file_chunk_sec: number
}>

type DiarizationOverrides = Partial<DiarizationConfig>

interface AppSettingsState {
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

  /**
   * STT 백엔드 모드(클라이언트-디바이스 로컬 설정 — 서버에 전송하지 않는다).
   * 'server' = 항상 서버 STT, 'local' = 항상 온디바이스(Android), 'auto' = 서버
   * 도달 불가 + 로컬 가능 시 자동 온디바이스 폴백. 기본 'auto'.
   * localStorage('sttMode')에 영속.
   */
  sttMode: 'server' | 'local' | 'auto'
  setSttMode: (mode: 'server' | 'local' | 'auto') => void

  /** opt-in: 로컬(온디바이스) 회의를 서버로 전송(transcript+오디오). localStorage. */
  localUploadEnabled: boolean
  setLocalUploadEnabled: (enabled: boolean) => void
}

// ── STT 모드/업로드: 클라이언트-디바이스 로컬 영속(localStorage, 서버 무전송) ──
const STT_MODE_KEY = 'sttMode'
const LOCAL_UPLOAD_KEY = 'localUploadEnabled'

function loadSttMode(): 'server' | 'local' | 'auto' {
  if (typeof localStorage === 'undefined') return 'auto'
  const v = localStorage.getItem(STT_MODE_KEY)
  return v === 'server' || v === 'local' || v === 'auto' ? v : 'auto'
}

function loadLocalUpload(): boolean {
  if (typeof localStorage === 'undefined') return false
  return localStorage.getItem(LOCAL_UPLOAD_KEY) === 'true'
}

// ── .env 동기화 (debounced) ────────────────────────
let saveTimer: ReturnType<typeof setTimeout> | null = null

function debouncedSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const s = useAppSettingsStore.getState()
    const payload: Partial<AppSettings> = {
      diarization_enabled: s.diarizationEnabled,
    }
    // 오디오: 오버라이드된 값만 전송, 기본값이면 전송하지 않음
    const audioKeys = ['silence_threshold', 'speech_threshold', 'silence_duration_ms', 'max_chunk_sec', 'min_chunk_sec', 'preroll_ms', 'overlap_ms', 'file_chunk_sec'] as const
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
    const diarKeys = ['clustering_threshold'] as const
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
    audioOverrides: {},
    setAudioOverride: (key, value) => {
      set((s) => ({ audioOverrides: { ...s.audioOverrides, [key]: value } }))
      debouncedSave()
    },
    resetAudioOverrides: () => { set({ audioOverrides: {} }); debouncedSave() },

    diarizationEnabled: false,
    setDiarizationEnabled: (enabled) => { set({ diarizationEnabled: enabled }); debouncedSave() },

    diarizationOverrides: {},
    setDiarizationOverride: (key, value) => {
      set((s) => ({ diarizationOverrides: { ...s.diarizationOverrides, [key]: value } }))
      debouncedSave()
    },
    resetDiarizationOverrides: () => { set({ diarizationOverrides: {} }); debouncedSave() },

    sttMode: loadSttMode(),
    setSttMode: (mode) => {
      set({ sttMode: mode })
      if (typeof localStorage !== 'undefined') localStorage.setItem(STT_MODE_KEY, mode)
    },

    localUploadEnabled: loadLocalUpload(),
    setLocalUploadEnabled: (enabled) => {
      set({ localUploadEnabled: enabled })
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(LOCAL_UPLOAD_KEY, String(enabled))
      }
    },

  }),
)

/** 앱 시작 시 .env에서 저장된 설정을 로드한다 */
export async function loadAppSettings() {
  try {
    const saved = await getAppSettings()
    const updates: Partial<AppSettingsState> = {}

    if (saved.diarization_enabled != null) updates.diarizationEnabled = saved.diarization_enabled

    // 오디오 오버라이드: settings.yaml 값이 있으면 무조건 적용 (기본값 비교 없이)
    const audioOverrides: AudioOverrides = {}
    const audioMap = {
      audio_silence_threshold: 'silence_threshold',
      audio_speech_threshold: 'speech_threshold',
      audio_silence_duration_ms: 'silence_duration_ms',
      audio_max_chunk_sec: 'max_chunk_sec',
      audio_min_chunk_sec: 'min_chunk_sec',
      audio_preroll_ms: 'preroll_ms',
      audio_overlap_ms: 'overlap_ms',
      audio_file_chunk_sec: 'file_chunk_sec',
    } as const
    for (const [envKey, storeKey] of Object.entries(audioMap)) {
      const val = saved[envKey as keyof AppSettings] as number | undefined
      if (val != null) {
        (audioOverrides as Record<string, number>)[storeKey] = val
      }
    }
    updates.audioOverrides = audioOverrides

    // 화자분리 오버라이드: settings.yaml 값이 있으면 무조건 적용
    const diarOverrides: DiarizationOverrides = {}
    const diarMap = {
      diarization_clustering_threshold: 'clustering_threshold',
    } as const
    for (const [envKey, storeKey] of Object.entries(diarMap)) {
      const val = saved[envKey as keyof AppSettings] as number | undefined
      if (val != null) {
        (diarOverrides as Record<string, number>)[storeKey] = val
      }
    }
    updates.diarizationOverrides = diarOverrides

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
