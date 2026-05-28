import { invoke } from '@tauri-apps/api/core'

let cachedPort: number | null = null

/**
 * 로컬 브릿지 포트 확보(성공 시 캐시). 모바일 Tauri 전용.
 * 브릿지 리스너는 setup()에서 비동기로 바인딩되므로 부팅 직후엔 아직 null일 수 있다.
 * ~3초 동안 100ms 간격으로 폴링하다 포트가 잡히면 즉시 캐시·반환한다.
 * 끝까지 못 잡으면(진짜 실패) null. 한 번 잡힌 포트는 캐시되어 이후 호출은 즉시 반환.
 */
export async function ensureBridgePort(): Promise<number | null> {
  if (cachedPort != null) return cachedPort
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    try {
      const p = (await invoke<number | null>('bridge_port')) ?? null
      if (p != null) {
        cachedPort = p
        return cachedPort
      }
    } catch {
      /* 아직 준비 안 됨 — 재시도 */
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  return null
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
