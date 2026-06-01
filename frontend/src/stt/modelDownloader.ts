/**
 * modelDownloader — 온디바이스 Cohere int8 모델(2.7GB) 다운로드 프론트 래퍼.
 *
 * 실제 스트리밍 다운로드는 Rust `download_cohere_model`(reqwest stream → 샌드박스,
 * temp→fsync→rename + .data 사이즈가드)가 수행한다. JS는 호출 + 진행률 이벤트 구독만.
 * (JS writeFile로 2.7GB를 받으면 전체적재 OOM — 반드시 Rust 경로.)
 *
 * 호스트(LAN 서버) = getApiBaseUrl() 기반. 서버가 `cohere-onnx/<file>`을 정적 제공한다고
 * 가정(플랜 Task 11 — 서버측 정적 라우트는 별도). 설계 §4 + 자동결정 A-T11.
 */
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

import { getApiBaseUrl } from '../config'

export interface ModelDownloadProgress {
  file: string
  received: number
  total: number
  fileIndex: number
  fileCount: number
  done?: boolean
}

export interface ModelStatus {
  present: boolean
  dir: string
  missing: string[]
  /** 현재 설치된(존재하는) 모델 파일들의 총 바이트. 관리 UI 용량 표시용. */
  bytes: number
}

/** 모델 존재 여부 + 용량(다운로드/관리 게이트용). */
export async function cohereModelStatus(): Promise<ModelStatus> {
  return invoke<ModelStatus>('cohere_model_status')
}

/**
 * adb 스테이징(`/data/local/tmp/cohere-onnx`)에서 샌드박스로 모델을 복사한다(개발/사전적재
 * 기기용, 네트워크 불필요). 스테이징이 없으면 reject — 호출자는 네트워크 다운로드로 폴백한다.
 * 반환: 설치된 모델 경로.
 */
export async function ensureCohereModel(): Promise<{ dir: string }> {
  return invoke<{ dir: string }>('ensure_cohere_model')
}

/** 설치된 모델 4파일을 삭제해 디스크를 회수한다(관리 UI "모델 삭제"). 멱등. */
export async function deleteCohereModel(): Promise<void> {
  await invoke('delete_cohere_model')
}

/**
 * 모델을 LAN 서버(base)에서 스트리밍 다운로드한다. 진행률은 onProgress로 전달.
 * @param baseUrl 기본값 = getApiBaseUrl()(LAN 서버). 폴백 CDN은 호출자가 다른 base로 재시도.
 * 반환: 설치된 모델 경로(dir 등).
 */
export async function downloadCohereModel(
  onProgress?: (p: ModelDownloadProgress) => void,
  baseUrl?: string,
): Promise<{ dir: string }> {
  const base = baseUrl ?? getApiBaseUrl()
  let unlisten: (() => void) | null = null
  if (onProgress) {
    unlisten = await listen<ModelDownloadProgress>('stt://model-download', (e) =>
      onProgress(e.payload),
    )
  }
  try {
    return await invoke<{ dir: string }>('download_cohere_model', { baseUrl: base })
  } finally {
    unlisten?.()
  }
}
