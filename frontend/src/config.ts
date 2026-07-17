/** 프로젝트 루트 config.yaml에서 설정을 로드한다. */
import { parse } from 'yaml'
import configYaml from '../../config.yaml?raw'
import { ensureBridgePort, getCachedBridgePort, setBridgeTarget } from './lib/bridge'

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
  api: { base_url: string; ws_url: string; default_server_url?: string }
  sidecar: { host: string; port: number; timeout_sec: number }
  stt_engines: Record<string, SttEngine>
  audio: AudioConfig
  languages: LanguageOption[]
  meeting_types: LabelValue[]
  diarization: {
    clustering_threshold: number
    ahc_threshold: number
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

// ── 모바일 환경 감지 (Tauri Android/iOS + 모바일 웹/PWA) ──
// 모바일에서는 설정 변경 불가(설정 진입 숨김), 항상 서버모드 등 제한 동작에 사용
export const IS_MOBILE =
  typeof navigator !== 'undefined' &&
  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

// ── 모드 / 서버 URL ─────────────────────────────
export function getMode(): 'local' | 'server' {
  // 플랫폼이 모드를 결정한다.
  // - 웹 브라우저(데스크톱·모바일) + 모든 모바일 → 항상 server (로컬 사이드카 없음).
  // - 맥 데스크톱 앱(Tauri desktop)만 localStorage 선택(로컬/원격서버)을 따른다.
  if (!IS_TAURI || IS_MOBILE) return 'server'
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

/** config.yaml에 지정된 서버 모드 기본 URL (없으면 빈 문자열). */
export function getDefaultServerUrl(): string {
  return cfg.api.default_server_url || ''
}

/**
 * 사용자가 저장한 서버 URL을 반환한다.
 * 저장값이 없으면 config.yaml의 기본값(`default_server_url`)으로 폴백한다.
 */
export function getServerUrl(): string {
  return localStorage.getItem('server_url') || getDefaultServerUrl()
}

/**
 * 현재 접속 서버를 식별하는 키. 토큰을 서버별로 보관할 때 사용한다.
 * - 로컬 모드(맥 데스크톱 앱): 'local'
 * - 웹 브라우저: 페이지 origin (Caddy가 단일 origin으로 묶음)
 * - 모바일/데스크톱 서버 모드: 저장된 서버 URL
 */
export function getServerKey(): string {
  if (getMode() !== 'server') return 'local'
  if (!IS_TAURI) return window.location.origin
  return getServerUrl()
}

// ── 모바일 루프백 브릿지 초기화 ───────────────────
// 안드로이드 WebView는 secure origin(https://tauri.localhost)이라 평문 http 서버를
// 직접 호출하면 mixed-content로 차단된다. 그래서 앱 내부 루프백 브릿지(127.0.0.1:<port>)로
// API/WS를 보내고, 브릿지가 선택된 서버로 전달한다. 부팅 시 1회 호출해 포트를 캐시하고
// 저장된 서버를 브릿지 전달 대상으로 설정한다. getApiBaseUrl()/getWsUrl()이 동기 함수이므로
// 캐시된 포트가 준비된 뒤에 앱 코드가 import/실행되도록 main.tsx에서 먼저 await 한다.
export async function initMobileBridge(): Promise<void> {
  if (!(IS_TAURI && IS_MOBILE)) return
  await ensureBridgePort()
  const saved = getServerUrl()
  if (saved) {
    try {
      await setBridgeTarget(saved)
    } catch {
      /* ignore */
    }
  }
}

// ── API / WebSocket URL 동적 결정 ────────────────

/**
 * API origin — 경로 접미사 없는 "http(s)://host[:port]". Rust probe_url 등
 * bare origin을 기대하는 네이티브 계약에 이 값을 넘긴다(probe_url이 /api/v1/health를
 * 직접 붙이므로 /api/v1 포함 URL을 넘기면 경로가 이중으로 붙어 항상 404가 된다).
 * 미설정(브릿지 포트/서버주소 부재) 시 ''. silent fallback 금지.
 */
export function getApiOrigin(): string {
  if (getMode() === 'server') {
    // 웹 브라우저: 페이지와 동일 origin을 사용한다. Caddy가 프론트와 /api·/auth·/cable을
    // 한 origin으로 묶으므로 IP 입력·CORS가 필요 없고, 접속 호스트가 바뀌어도 자동 추종한다.
    if (!IS_TAURI) return window.location.origin
    // 모바일 앱(Tauri Android): 루프백 브릿지를 경유한다(mixed-content 회피).
    if (IS_MOBILE) {
      const port = getCachedBridgePort()
      return port != null ? `http://127.0.0.1:${port}` : ''
    }
    // 데스크톱 서버 모드(맥 앱): 사용자가 입력한 서버 주소.
    return getServerUrl() || ''
  }
  // 로컬 모드(맥 데스크톱 앱): 항상 127.0.0.1:13323
  return 'http://127.0.0.1:13323'
}

export function getApiBaseUrl(): string {
  const origin = getApiOrigin()
  return origin ? `${origin}/api/v1` : ''
}

export function getWsUrl(): string {
  if (getMode() === 'server') {
    // 웹 브라우저: 페이지와 동일 origin (http→ws / https→wss).
    if (!IS_TAURI) return window.location.origin.replace(/^http/, 'ws') + '/cable'
    // 모바일 앱(Tauri Android): 루프백 브릿지를 경유한다.
    if (IS_MOBILE) {
      const port = getCachedBridgePort()
      return port != null ? `ws://127.0.0.1:${port}/cable` : ''
    }
    // 데스크톱 서버 모드(맥 앱): 사용자가 입력한 서버 주소.
    const serverUrl = getServerUrl()
    if (serverUrl) {
      return serverUrl
        .replace(/^https:\/\//, 'wss://')
        .replace(/^http:\/\//, 'ws://') + '/cable'
    }
    return ''
  }
  // 로컬 모드(맥 데스크톱 앱): 항상 127.0.0.1:13323
  return 'ws://127.0.0.1:13323/cable'
}

// ── STT 엔진 라벨 ─────────────────────────────
// 실시간 STT 셀렉터 + 회의 상세(EditMeetingDialog) 등에서 쓰는 라벨. config.yaml
// 원문 그대로 사용하며 배치 전용 override를 섞지 않는다 (whisper_cpp가 실시간/배치
// 양쪽 available 목록에 모두 등장하므로, 여기 override하면 실시간 라디오까지 새어나감).
export const ENGINE_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(cfg.stt_engines).map(([k, v]) => [k, v.label]),
)

// 배치(파일 재전사) STT 셀렉터 전용 라벨. 실시간 라벨을 베이스로 배치 전용 엔진
// 라벨과 whisper_cpp 등 배치용 문구 override를 추가한다 — 이 맵은 BatchSttModelCard
// (SttSettingsPanel.tsx)에서만 사용하고 실시간 셀렉터에는 절대 쓰지 않을 것.
export const BATCH_ENGINE_LABELS: Record<string, string> = {
  ...ENGINE_LABELS,
  mlx_whisper_turbo_8bit: '8bit (빠름)',
  mlx_whisper_turbo_f16: '16bit (정확, 느림)',
  mlx_whisper_turbo_beam: 'Beam 16bit (환각 적음, 정확)',
  mlx_whisper_turbo_beam_8bit: 'Beam 8bit (환각 적음, 빠름)',
  whisper_cpp: 'gguf f16 (whisper.cpp, ggml turbo)',
}

export const ENGINE_LABELS_SHORT: Record<string, string> = Object.fromEntries(
  Object.entries(cfg.stt_engines).map(([k, v]) => [k, v.short]),
)

// ── 오디오 청킹 ───────────────────────────────
export const AUDIO = cfg.audio
export const AUDIO_DEFAULTS: Readonly<AudioConfig> = { ...cfg.audio }

// ── 화자 분리 ───────────────────────────────
export type DiarizationConfig = typeof cfg.diarization
export const DIARIZATION = cfg.diarization
// config.yaml에 ahc_threshold가 없으면 0.3을 기본값으로 사용 (화자 구분 민감도)
export const DIARIZATION_DEFAULTS: Readonly<DiarizationConfig> = {
  ...cfg.diarization,
  ahc_threshold: cfg.diarization.ahc_threshold ?? 0.3,
}

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
