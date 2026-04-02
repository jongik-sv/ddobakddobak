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
    return 'ws://127.0.0.1:13323/cable'
  }
  // 로컬 모드: Tauri는 항상 13323, 웹 dev는 환경변수 또는 config.yaml
  return IS_TAURI
    ? 'ws://127.0.0.1:13323/cable'
    : import.meta.env.VITE_WS_URL || cfg.api.ws_url
}

// ── 하위 호환용 상수 (기존 코드 사용처 대응) ──────
// 주의: 이 상수들은 모듈 로드 시점의 값으로 고정된다.
// ServerSetup 완료 후 모드가 변경되면 앱이 리로드/리마운트되어야 반영된다.
export const API_BASE_URL = getApiBaseUrl()
export const WS_URL = getWsUrl()

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
