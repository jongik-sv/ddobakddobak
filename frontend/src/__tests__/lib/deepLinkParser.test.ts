import { describe, it, expect } from 'vitest';
import { parseDeepLink } from '../../lib/deepLinkParser';

describe('parseDeepLink', () => {
  it('유효한 callback URL에서 token을 추출한다', () => {
    const result = parseDeepLink('ddobak://callback?token=eyJhbGci...');
    expect(result).toEqual({ type: 'callback', token: 'eyJhbGci...' });
  });

  it('token이 없으면 null을 반환한다', () => {
    expect(parseDeepLink('ddobak://callback')).toBeNull();
  });

  it('hostname이 callback이 아니면 null을 반환한다', () => {
    expect(parseDeepLink('ddobak://other?token=xxx')).toBeNull();
  });

  it('protocol이 ddobak이 아니면 null을 반환한다', () => {
    expect(parseDeepLink('https://callback?token=xxx')).toBeNull();
  });

  it('잘못된 URL이면 null을 반환한다', () => {
    expect(parseDeepLink('not-a-url')).toBeNull();
  });

  it('URL-encoded token을 올바르게 처리한다', () => {
    const encoded = encodeURIComponent('eyJ+test/value=');
    const result = parseDeepLink(`ddobak://callback?token=${encoded}`);
    expect(result?.token).toBe('eyJ+test/value=');
  });

  it('빈 문자열이면 null을 반환한다', () => {
    expect(parseDeepLink('')).toBeNull();
  });
});
