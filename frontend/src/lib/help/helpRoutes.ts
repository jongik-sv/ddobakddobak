/** 매뉴얼 기본 URL (끝에 / 포함). */
export const MANUAL_BASE_URL = 'https://jongik-sv.github.io/ddobakddobak/manual/'

/** 라우트 패턴 → 매뉴얼 slug. 위에서부터 첫 일치. `:param` 은 한 세그먼트, 끝의 `*` 는 하위 전체. */
export const HELP_ROUTES: ReadonlyArray<readonly [pattern: string, slug: string]> = [
  ['/', 'start/project-select'],
  ['/dashboard', 'meetings/dashboard'],
  ['/search', 'ai/search'],
  ['/projects', 'projects/projects'],
  ['/meetings', 'meetings/list'],
  ['/meetings/:id/live', 'recording/live'],
  ['/meetings/:id/viewer', 'share/live-share'],
  ['/meetings/:id', 'minutes/meeting-detail'],
  ['/trash', 'trash/trash'],
  ['/local-meetings*', 'recording/offline'],
  ['/invite/:code', 'projects/projects'],
]

/** data-help / data-help-page 로 쓰이는 slug (코드에서 직접 사용하는 값). */
export const HELP_ATTR_SLUGS: readonly string[] = [
  'settings/personal',
  'settings/llm',
  'settings/voice',
  'settings/meeting',
  'settings/integrations',
  'settings/users',
  'start/first-run',
  'start/login',
]

function matchPattern(pattern: string, pathname: string): boolean {
  const prefix = pattern.endsWith('*')
  const pat = (prefix ? pattern.slice(0, -1) : pattern).split('/').filter(Boolean)
  const parts = pathname.split('/').filter(Boolean)
  if (prefix ? parts.length < pat.length : parts.length !== pat.length) return false
  return pat.every((seg, i) => seg.startsWith(':') || seg === parts[i])
}

export function slugForPath(pathname: string): string | null {
  for (const [pattern, slug] of HELP_ROUTES) {
    if (matchPattern(pattern, pathname)) return slug
  }
  return null
}
