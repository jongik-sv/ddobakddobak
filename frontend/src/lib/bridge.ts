import { invoke } from '@tauri-apps/api/core'

let cachedPort: number | null = null

/** 로컬 브릿지 포트 확보(1회 캐시). 모바일 Tauri 전용. 실패 시 null. */
export async function ensureBridgePort(): Promise<number | null> {
  if (cachedPort != null) return cachedPort
  try {
    cachedPort = (await invoke<number | null>('bridge_port')) ?? null
  } catch {
    cachedPort = null
  }
  return cachedPort
}

/** 동기 접근용 — ensureBridgePort()가 먼저 성공해 있어야 유효. */
export function getCachedBridgePort(): number | null {
  return cachedPort
}

export function setBridgeTarget(url: string): Promise<void> {
  return invoke('set_bridge_target', { url })
}

export async function mdnsBrowse(): Promise<{ name: string; url: string }[]> {
  try {
    return await invoke('mdns_browse')
  } catch {
    return []
  }
}

export async function probeUrl(url: string): Promise<boolean> {
  try {
    return await invoke('probe_url', { url })
  } catch {
    return false
  }
}
