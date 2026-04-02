import { describe, it, expect } from 'vitest'
import { parseDeepLink } from '../../lib/deepLinkParser'

describe('parseDeepLink', () => {
  it('유효한 callback URL에서 accessToken과 refreshToken을 추출한다', () => {
    const result = parseDeepLink(
      'ddobak://callback?access_token=eyJhbGci...&refresh_token=eyJyZWYi...',
    )
    expect(result).toEqual({
      type: 'callback',
      accessToken: 'eyJhbGci...',
      refreshToken: 'eyJyZWYi...',
    })
  })

  it('access_token이 없으면 null을 반환한다', () => {
    expect(
      parseDeepLink('ddobak://callback?refresh_token=eyJyZWYi...'),
    ).toBeNull()
  })

  it('refresh_token이 없으면 null을 반환한다', () => {
    expect(
      parseDeepLink('ddobak://callback?access_token=eyJhbGci...'),
    ).toBeNull()
  })

  it('두 토큰 모두 없으면 null을 반환한다', () => {
    expect(parseDeepLink('ddobak://callback')).toBeNull()
  })

  it('hostname이 callback이 아니면 null을 반환한다', () => {
    expect(
      parseDeepLink(
        'ddobak://other?access_token=xxx&refresh_token=yyy',
      ),
    ).toBeNull()
  })

  it('protocol이 ddobak이 아니면 null을 반환한다', () => {
    expect(
      parseDeepLink(
        'https://callback?access_token=xxx&refresh_token=yyy',
      ),
    ).toBeNull()
  })

  it('잘못된 URL이면 null을 반환한다', () => {
    expect(parseDeepLink('not-a-url')).toBeNull()
  })

  it('URL-encoded 토큰을 올바르게 처리한다', () => {
    const encodedAccess = encodeURIComponent('eyJ+test/value=')
    const encodedRefresh = encodeURIComponent('ref+test/value=')
    const result = parseDeepLink(
      `ddobak://callback?access_token=${encodedAccess}&refresh_token=${encodedRefresh}`,
    )
    expect(result?.accessToken).toBe('eyJ+test/value=')
    expect(result?.refreshToken).toBe('ref+test/value=')
  })

  it('빈 문자열이면 null을 반환한다', () => {
    expect(parseDeepLink('')).toBeNull()
  })
})
