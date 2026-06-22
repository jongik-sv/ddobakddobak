import { describe, it, expect, beforeEach } from 'vitest'

describe('clientId', () => {
  beforeEach(() => localStorage.clear())

  it('getClientId 가 UUID 를 생성·영속하고 멱등', async () => {
    const { getClientId } = await import('./clientId')
    const a = getClientId()
    expect(a).toMatch(/^[0-9a-f-]{36}$/i)
    expect(getClientId()).toBe(a) // 같은 값 재사용
    expect(localStorage.getItem('ddobak_client_id')).toBe(a)
  })

  it('getClientPlatform 은 web (테스트 환경)', async () => {
    const { getClientPlatform } = await import('./clientId')
    expect(['web', 'desktop', 'mobile']).toContain(getClientPlatform())
  })
})
