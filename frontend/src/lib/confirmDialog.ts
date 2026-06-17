import { IS_TAURI } from '../config'

/**
 * 플랫폼 안전 확인 다이얼로그.
 *
 * Tauri(WKWebView)에서는 동기 `window.confirm`이 블로킹되지 않아 사용자가
 * 응답하기 전에 후속 코드가 실행되는 버그가 있다(예: Cancel을 눌러도 이미 삭제됨).
 * Tauri에서는 비동기 plugin-dialog `confirm`을 await 한다. 웹은 `window.confirm` fallback.
 */
export async function confirmDialog(
  message: string,
  opts?: { title?: string; kind?: 'warning' | 'error' | 'info' }
): Promise<boolean> {
  if (IS_TAURI) {
    const { confirm } = await import('@tauri-apps/plugin-dialog')
    return confirm(message, opts)
  }
  return window.confirm(message)
}
