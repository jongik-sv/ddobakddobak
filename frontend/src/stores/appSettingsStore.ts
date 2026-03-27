import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  DEFAULT_SUMMARY_INTERVAL_SEC,
  AUDIO,
  AUDIO_DEFAULTS,
  DIARIZATION_DEFAULTS,
  LANGUAGES,
} from '../config'
import type { DiarizationConfig } from '../config'

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

export const useAppSettingsStore = create<AppSettingsState>()(
  persist(
    (set) => ({
      summaryIntervalSec: DEFAULT_SUMMARY_INTERVAL_SEC,
      setSummaryIntervalSec: (sec) => set({ summaryIntervalSec: sec }),

      audioOverrides: {},
      setAudioOverride: (key, value) =>
        set((s) => ({ audioOverrides: { ...s.audioOverrides, [key]: value } })),
      resetAudioOverrides: () => set({ audioOverrides: {} }),

      diarizationEnabled: true,
      setDiarizationEnabled: (enabled) => set({ diarizationEnabled: enabled }),

      diarizationOverrides: {},
      setDiarizationOverride: (key, value) =>
        set((s) => ({ diarizationOverrides: { ...s.diarizationOverrides, [key]: value } })),
      resetDiarizationOverrides: () => set({ diarizationOverrides: {} }),

      selectedLanguages: [LANGUAGES[0]?.code ?? 'ko'],
      toggleLanguage: (code) =>
        set((s) => {
          const current = s.selectedLanguages
          if (current.includes(code)) {
            // 최소 1개는 선택되어야 함
            if (current.length <= 1) return s
            return { selectedLanguages: current.filter((c) => c !== code) }
          }
          return { selectedLanguages: [...current, code] }
        }),
    }),
    { name: 'ddobak-app-settings' },
  ),
)

/** config.yaml 기본값 + 사용자 오버라이드를 병합한 오디오 설정 반환 */
export function getEffectiveAudioConfig() {
  const overrides = useAppSettingsStore.getState().audioOverrides
  return { ...AUDIO, ...overrides }
}

export { AUDIO_DEFAULTS, DIARIZATION_DEFAULTS }
