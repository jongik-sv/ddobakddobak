// 공유 가능한 링크 base. 현재 origin이 localhost/127.0.0.1/tauri.localhost면(로컬 loopback)
// 외부인이 못 여므로, 백엔드 health의 lan_url(LAN IP 기반)로 치환한다. 1회 fetch 캐시.
import { getApiBaseUrl } from '../config'

let cachedLanUrl: string | null | undefined // undefined=미조회, null=없음

export function __resetShareUrlCache() { cachedLanUrl = undefined } // 테스트용

function isLocalOrigin(origin: string): boolean {
  // localhost / 127.0.0.1 / tauri.localhost(안드로이드) = 외부 공유 불가 origin
  return /^https?:\/\/(localhost|127\.0\.0\.1|tauri\.localhost)(:|\/|$)/.test(origin)
}

export async function getShareBaseUrl(): Promise<string> {
  const origin = window.location.origin
  if (!isLocalOrigin(origin)) return origin
  if (cachedLanUrl === undefined) {
    const apiBase = getApiBaseUrl() // http://127.0.0.1:13323/api/v1 (Tauri) 또는 https://host/api/v1 (web)
    if (!apiBase) { cachedLanUrl = null }
    else {
      try {
        const res = await fetch(`${apiBase}/health`)
        const data = await res.json()
        cachedLanUrl = typeof data.lan_url === 'string' ? data.lan_url : null
      } catch {
        cachedLanUrl = null
      }
    }
  }
  return cachedLanUrl || origin
}
