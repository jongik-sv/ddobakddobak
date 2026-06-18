import type { SelectedFolder } from '../stores/folderStore'

/**
 * 폴더 선택을 URL 쿼리(`?folder=`)로 인코딩/디코딩한다.
 * URL을 폴더 선택의 단일 소스로 삼아 브라우저 뒤로가기가 부모 폴더로 동작하게 한다.
 * - 'all'  → "all"  (전체 회의)
 * - null   → "none" (미분류)
 * - number → "<id>"
 */
export function folderToParam(id: SelectedFolder): string {
  if (id === 'all') return 'all'
  if (id === null) return 'none'
  return String(id)
}

export function paramToFolder(p: string | null): SelectedFolder {
  if (p === null || p === 'all' || p === '') return 'all'
  if (p === 'none') return null
  const n = Number(p)
  return Number.isFinite(n) ? n : 'all'
}

/** 폴더 선택용 /meetings 경로(쿼리 포함) */
export function folderPath(id: SelectedFolder): string {
  return `/meetings?folder=${folderToParam(id)}`
}
