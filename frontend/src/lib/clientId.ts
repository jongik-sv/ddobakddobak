import { IS_TAURI, IS_MOBILE } from '../config'

const KEY = 'ddobak_client_id'

/** 기기/브라우저별 안정적 클라이언트 ID. 없으면 생성·영속(localStorage). */
export function getClientId(): string {
  let id = localStorage.getItem(KEY)
  if (!id) {
    id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`
    localStorage.setItem(KEY, id)
  }
  return id
}

export function getClientPlatform(): 'desktop' | 'mobile' | 'web' {
  if (IS_MOBILE) return 'mobile'
  if (IS_TAURI) return 'desktop'
  return 'web'
}
