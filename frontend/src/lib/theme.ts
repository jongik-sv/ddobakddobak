export type Theme = 'light' | 'dark' | 'system'

const THEME_KEY = 'theme'

/** localStorage에서 테마 읽기. 유효값만 통과, 아니면 'system' */
export function loadTheme(): Theme {
  try {
    const raw = localStorage.getItem(THEME_KEY)
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw
  } catch {
    /* 무시 */
  }
  return 'system'
}

export function saveTheme(t: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, t)
  } catch {
    /* 무시 */
  }
}

/** OS가 다크를 선호하는지 */
export function prefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

/** system이면 OS 선호도 기반으로 light/dark 확정 */
export function resolveTheme(t: Theme): 'light' | 'dark' {
  if (t === 'system') return prefersDark() ? 'dark' : 'light'
  return t
}

/** <html>에 .dark 클래스를 토글해 전체 색을 재평가 */
export function applyTheme(t: Theme): void {
  document.documentElement.classList.toggle('dark', resolveTheme(t) === 'dark')
}
