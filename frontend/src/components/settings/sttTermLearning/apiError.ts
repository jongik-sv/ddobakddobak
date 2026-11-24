/** ky HTTPError 응답 본문에서 error/message 를 꺼낸다. 없으면 fallback. */
export async function apiErrorMessage(err: unknown, fallback: string): Promise<string> {
  try {
    const res = (err as { response?: Response }).response
    if (res) {
      const body = await res.json()
      const msg = body?.error ?? body?.message
      if (typeof msg === 'string' && msg) return msg
    }
  } catch {
    /* 본문 없음 */
  }
  return fallback
}
