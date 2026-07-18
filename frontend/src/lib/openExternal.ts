import { IS_TAURI } from '../config'

export async function openExternal(url: string): Promise<void> {
  if (IS_TAURI) {
    const { open } = await import('@tauri-apps/plugin-shell')
    await open(url)
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}
