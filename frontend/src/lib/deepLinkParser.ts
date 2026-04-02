export interface DeepLinkResult {
  type: 'callback';
  token: string;
}

export function parseDeepLink(url: string): DeepLinkResult | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'ddobak:') return null;
    if (parsed.hostname !== 'callback') return null;
    const token = parsed.searchParams.get('token');
    if (!token) return null;
    return { type: 'callback', token };
  } catch {
    return null;
  }
}
