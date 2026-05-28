const RECENT_SERVERS_KEY = 'recent_servers'
const MAX_SAVED = 10

export const DEFAULT_PORT = '13323'

export interface SavedServer {
  url: string
  name?: string
  location?: string
  lastConnectedAt: number
}

/** 저장소의 한 항목(문자열=구버전 / 객체=신버전)을 SavedServer로 변환. 실패 시 null. */
function coerce(item: unknown): SavedServer | null {
  if (typeof item === 'string') return { url: item, lastConnectedAt: 0 }
  if (item && typeof item === 'object') {
    const o = item as Record<string, unknown>
    if (typeof o.url !== 'string') return null
    return {
      url: o.url,
      name: typeof o.name === 'string' ? o.name : undefined,
      location: typeof o.location === 'string' ? o.location : undefined,
      lastConnectedAt: typeof o.lastConnectedAt === 'number' ? o.lastConnectedAt : 0,
    }
  }
  return null
}

/** 저장된 서버 목록을 로드한다(구버전 string[] 마이그레이션, 최근접속순 정렬). */
export function loadSavedServers(): SavedServer[] {
  try {
    const raw = localStorage.getItem(RECENT_SERVERS_KEY)
    const arr = raw ? JSON.parse(raw) : []
    if (!Array.isArray(arr)) return []
    const list = arr.map(coerce).filter((s): s is SavedServer => s !== null)
    return list.sort((a, b) => b.lastConnectedAt - a.lastConnectedAt)
  } catch {
    return []
  }
}

/** 정렬·캡 적용 후 저장하고 최신 목록을 반환. */
function save(list: SavedServer[]): SavedServer[] {
  const sorted = [...list].sort((a, b) => b.lastConnectedAt - a.lastConnectedAt).slice(0, MAX_SAVED)
  localStorage.setItem(RECENT_SERVERS_KEY, JSON.stringify(sorted))
  return sorted
}

/** 접속 성공한 url 을 기록한다. 기존 항목이면 name/location 보존, lastConnectedAt 만 갱신. */
export function upsertOnConnect(url: string): SavedServer[] {
  const now = Date.now()
  const list = loadSavedServers()
  const existing = list.find((s) => s.url === url)
  if (existing) {
    existing.lastConnectedAt = now
    return save(list)
  }
  return save([{ url, lastConnectedAt: now }, ...list])
}

/**
 * url 항목의 이름/위치를 저장한다. 빈 문자열은 제거(undefined).
 * 없는 url 이면 미접속(lastConnectedAt=0) 항목으로 새로 만든다 — 스캔 직후 연결 전 편집 지원.
 */
export function upsertServerMeta(
  url: string,
  patch: { name?: string; location?: string },
): SavedServer[] {
  const list = loadSavedServers()
  const target = list.find((s) => s.url === url) ?? { url, lastConnectedAt: 0 }
  if (patch.name !== undefined) target.name = patch.name.trim() || undefined
  if (patch.location !== undefined) target.location = patch.location.trim() || undefined
  if (!list.includes(target)) list.unshift(target)
  return save(list)
}

/** url 항목을 삭제한다. */
export function removeSavedServer(url: string): SavedServer[] {
  return save(loadSavedServers().filter((s) => s.url !== url))
}

/** url 에서 호스트만 추출. 파싱 실패 시 원문 반환. */
export function displayHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

/** url 의 포트. 기본포트(13323) 또는 파싱 실패면 null. */
export function displayPort(url: string): string | null {
  try {
    const port = new URL(url).port
    if (!port || port === DEFAULT_PORT) return null
    return port
  } catch {
    return null
  }
}
