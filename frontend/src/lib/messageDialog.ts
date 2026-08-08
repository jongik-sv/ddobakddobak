import { IS_TAURI } from '../config'

/**
 * 플랫폼 안전 알림 다이얼로그.
 *
 * Tauri에서는 plugin-dialog의 `message()`를 사용하고, 웹에서는 `window.alert` fallback.
 */
export async function messageDialog(
  text: string,
  opts?: { title?: string; kind?: 'warning' | 'error' | 'info' }
): Promise<void> {
  if (IS_TAURI) {
    const { message } = await import('@tauri-apps/plugin-dialog')
    await message(text, opts)
    return
  }
  window.alert(text)
}
