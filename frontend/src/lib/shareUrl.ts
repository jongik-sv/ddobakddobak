// 공유 가능한 링크 base. 현재 origin이 localhost/127.0.0.1면(맥 본체 loopback 접속)
// 외부인이 못 여므로, 백엔드 health의 lan_url(LAN IP 기반)로 치환한다. 1회 fetch 캐시.
let cachedLanUrl: string | null | undefined // undefined=미조회, null=없음

export function __resetShareUrlCache() { cachedLanUrl = undefined } // 테스트용

function isLocalOrigin(origin: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(origin)
}

export async function getShareBaseUrl(): Promise<string> {
  const origin = window.location.origin
  if (!isLocalOrigin(origin)) return origin
  if (cachedLanUrl === undefined) {
    try {
      const res = await fetch(`${origin}/api/v1/health`)
      const data = await res.json()
      cachedLanUrl = typeof data.lan_url === 'string' ? data.lan_url : null
    } catch {
      cachedLanUrl = null
    }
  }
  return cachedLanUrl || origin
}
