/** Stub for @tauri-apps/plugin-deep-link (not installed as npm dep) */
export function onOpenUrl(_callback: (urls: string[]) => void): Promise<() => void> {
  return Promise.resolve(() => {})
}
