/** 프로젝트 루트 config.yaml에서 설정을 로드한다. */
import { parse } from 'yaml'
import configYaml from '../../config.yaml?raw'

interface SttEngine {
  label: string
  short: string
}

interface IntervalOption {
  value: number
  label: string
}

interface AudioConfig {
  sample_rate: number
  silence_threshold: number
  speech_threshold: number
  silence_duration_ms: number
  max_chunk_sec: number
  min_chunk_sec: number
  preroll_ms: number
  overlap_ms: number
  file_chunk_sec: number
}

interface LanguageOption {
  code: string
  label: string
}

interface LabelValue {
  value: string
  label: string
}

interface AppConfig {
  api: { base_url: string; ws_url: string }
  sidecar: { host: string; port: number; timeout_sec: number }
  stt_engines: Record<string, SttEngine>
  audio: AudioConfig
  languages: LanguageOption[]
  meeting_types: LabelValue[]
  diarization: {
    similarity_threshold: number
    merge_threshold: number
    max_embeddings_per_speaker: number
  }
  summary: {
    default_interval_sec: number
    interval_options: IntervalOption[]
  }
}

const cfg = parse(configYaml) as AppConfig

// ── Tauri 환경 감지 ─────────────────────────────
export const IS_TAURI =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

// ── 모드 / 서버 URL ─────────────────────────────
export function getMode(): 'local' | 'server' {
  const mode = localStorage.getItem('mode')
  return mode === 'server' ? 'server' : 'local'
}

/** localStorage에 mode 키가 존재하는지 (한 번이라도 모드를 선택했는지) */
export function hasMode(): boolean {
  return localStorage.getItem('mode') !== null
}

/** 모드 설정을 초기화한다 (재설정 시 사용). */
export function clearMode(): void {
  localStorage.removeItem('mode')
  localStorage.removeItem('server_url')
}

export function getServerUrl(): string {
  return localStorage.getItem('server_url') || ''
}

// ── API / WebSocket URL 동적 결정 ────────────────
export function getApiBaseUrl(): string {
  if (getMode() === 'server') {
    const serverUrl = getServerUrl()
    return serverUrl ? `${serverUrl}/api/v1` : 'http://127.0.0.1:13323/api/v1'
  }
  // 로컬 모드: Tauri는 항상 13323, 웹 dev는 환경변수 또는 config.yaml
  return IS_TAURI
    ? 'http://127.0.0.1:13323/api/v1'
    : import.meta.env.VITE_API_BASE_URL || cfg.api.base_url
}

export function getWsUrl(): string {
  if (getMode() === 'server') {
    const serverUrl = getServerUrl()
    if (serverUrl) {
      return serverUrl
        .replace(/^https:\/\//, 'wss://')
        .replace(/^http:\/\//, 'ws://') + '/cable'
    }
  }
  return IS_TAURI
    ? 'ws://127.0.0.1:13323/cable'
    : import.meta.env.VITE_WS_URL || cfg.api.ws_url
}

// ── STT 엔진 라벨 ─────────────────────────────
export const ENGINE_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(cfg.stt_engines).map(([k, v]) => [k, v.label]),
)

export const ENGINE_LABELS_SHORT: Record<string, string> = Object.fromEntries(
  Object.entries(cfg.stt_engines).map(([k, v]) => [k, v.short]),
)

// ── 오디오 청킹 ───────────────────────────────
export const AUDIO = cfg.audio
export const AUDIO_DEFAULTS: Readonly<AudioConfig> = { ...cfg.audio }

// ── 화자 분리 ───────────────────────────────
export type DiarizationConfig = typeof cfg.diarization
export const DIARIZATION = cfg.diarization
export const DIARIZATION_DEFAULTS: Readonly<DiarizationConfig> = { ...cfg.diarization }

// ── 회의 언어 ─────────────────────────────────
export const LANGUAGES = cfg.languages

// ── 회의 유형 ─────────────────────────────────
export const MEETING_TYPES = cfg.meeting_types

// ── AI 회의록 ─────────────────────────────────
export const SUMMARY_INTERVAL_OPTIONS = cfg.summary.interval_options
export const DEFAULT_SUMMARY_INTERVAL_SEC = cfg.summary.default_interval_sec

// ── 반응형 브레이크포인트 ─────────────────────────
export const BREAKPOINTS = {
  sm: '(min-width: 640px)',
  md: '(min-width: 768px)',
  lg: '(min-width: 1024px)',
  xl: '(min-width: 1280px)',
} as const
