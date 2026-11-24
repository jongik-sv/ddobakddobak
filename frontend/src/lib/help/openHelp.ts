import { IS_TAURI } from '../../config'
import { MANUAL_BASE_URL } from './helpRoutes'
import { resolveHelpSlug } from './resolveHelpSlug'

export function buildHelpUrl(slug: string): string {
  const clean = slug.replace(/^\/+|\/+$/g, '')
  return clean ? `${MANUAL_BASE_URL}${clean}/` : MANUAL_BASE_URL
}

/** 현재 화면에 해당하는 매뉴얼 페이지를 연다. */
export async function openHelp(): Promise<void> {
  const url = buildHelpUrl(resolveHelpSlug(window.location.pathname, document))
  if (IS_TAURI) {
    try {
      const { open } = await import('@tauri-apps/plugin-shell')
      await open(url)
      return
    } catch {
      window.open(url, '_blank')
      return
    }
  }
  window.open(url, '_blank', 'noopener')
}
