import { useEffect } from 'react';
import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { parseDeepLink } from '../lib/deepLinkParser';

const TOKEN_KEY = 'access_token';

export function useDeepLink(onToken?: (token: string) => void): void {
  useEffect(() => {
    const unlisten = onOpenUrl((urls: string[]) => {
      for (const url of urls) {
        const result = parseDeepLink(url);
        if (result) {
          localStorage.setItem(TOKEN_KEY, result.token);
          onToken?.(result.token);
          break;
        }
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [onToken]);
}
