import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getShareBaseUrl, __resetShareUrlCache } from '../shareUrl'

function setOrigin(origin: string) {
  Object.defineProperty(window, 'location', { value: { origin }, writable: true, configurable: true })
}

describe('getShareBaseUrl', () => {
  beforeEach(() => { __resetShareUrlCache(); vi.restoreAllMocks() })

  it('비-localhost origin은 그대로 반환(health fetch 안 함)', async () => {
    setOrigin('https://172.30.1.3:13443')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    expect(await getShareBaseUrl()).toBe('https://172.30.1.3:13443')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('localhost면 health의 lan_url로 치환', async () => {
    setOrigin('https://localhost:13443')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ json: () => Promise.resolve({ lan_url: 'https://172.30.1.3:13443' }) } as Response)
    expect(await getShareBaseUrl()).toBe('https://172.30.1.3:13443')
  })

  it('localhost인데 lan_url 없으면 origin 폴백', async () => {
    setOrigin('https://localhost:13443')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ json: () => Promise.resolve({ status: 'ok' }) } as Response)
    expect(await getShareBaseUrl()).toBe('https://localhost:13443')
  })
})
