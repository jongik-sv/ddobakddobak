export interface DeepLinkResult {
  type: 'callback'
  accessToken: string
  refreshToken: string
}

export function parseDeepLink(url: string): DeepLinkResult | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'ddobak:') return null
    if (parsed.hostname !== 'callback') return null

    const accessToken = parsed.searchParams.get('access_token')
    const refreshToken = parsed.searchParams.get('refresh_token')
    if (!accessToken || !refreshToken) return null

    return { type: 'callback', accessToken, refreshToken }
  } catch {
    return null
  }
}
