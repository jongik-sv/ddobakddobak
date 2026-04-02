import { useEffect } from 'react'
import { onOpenUrl } from '@tauri-apps/plugin-deep-link'
import { parseDeepLink } from '../lib/deepLinkParser'
import { useAuthStore } from '../stores/authStore'

export function useDeepLink(): void {
  const setTokens = useAuthStore((s) => s.setTokens)

  useEffect(() => {
    const unlisten = onOpenUrl((urls: string[]) => {
      for (const url of urls) {
        const result = parseDeepLink(url)
        if (result) {
          setTokens(result.accessToken, result.refreshToken)
          break
        }
      }
    })
    return () => {
      unlisten.then((fn) => fn())
    }
  }, [setTokens])
}
