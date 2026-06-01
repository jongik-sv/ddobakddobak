import { describe, it, expect } from 'vitest'
import { COHERE_LANGS, isCohereLang, localSttLanguage } from './cohereLang'

describe('COHERE_LANGS', () => {
  it('Cohere 지원 14개 언어를 정확히 포함한다', () => {
    expect([...COHERE_LANGS]).toEqual([
      'ar',
      'de',
      'el',
      'en',
      'es',
      'fr',
      'it',
      'ja',
      'ko',
      'nl',
      'pl',
      'pt',
      'vi',
      'zh',
    ])
  })

  it('ddobak 9개 언어 중 th를 제외한 8개를 지원한다', () => {
    const ddobakLangs = ['ko', 'en', 'ja', 'zh', 'es', 'fr', 'de', 'th', 'vi']
    const supported = ddobakLangs.filter((l) => isCohereLang(l))
    expect(supported).toEqual(['ko', 'en', 'ja', 'zh', 'es', 'fr', 'de', 'vi'])
    expect(isCohereLang('th')).toBe(false)
  })
})

describe('localSttLanguage', () => {
  it('single + ko → "ko"', () => {
    expect(localSttLanguage({ mode: 'single', languages: ['ko'] })).toBe('ko')
  })

  it('single + th(미지원) → null (서버 폴백)', () => {
    expect(localSttLanguage({ mode: 'single', languages: ['th'] })).toBeNull()
  })

  it('multi → null (다국어 로컬 미지원)', () => {
    expect(localSttLanguage({ mode: 'multi', languages: ['ko', 'en'] })).toBeNull()
  })

  it('multi + 단일 지원 언어여도 null (모드 우선)', () => {
    expect(localSttLanguage({ mode: 'multi', languages: ['ko'] })).toBeNull()
  })

  it('빈 언어 배열 → null', () => {
    expect(localSttLanguage({ mode: 'single', languages: [] })).toBeNull()
  })

  it('single + en/ja/zh 모두 통과', () => {
    expect(localSttLanguage({ mode: 'single', languages: ['en'] })).toBe('en')
    expect(localSttLanguage({ mode: 'single', languages: ['ja'] })).toBe('ja')
    expect(localSttLanguage({ mode: 'single', languages: ['zh'] })).toBe('zh')
  })

  it('single + 미지원 ISO(it/de는 지원, xx는 미지원) → null', () => {
    expect(localSttLanguage({ mode: 'single', languages: ['xx'] })).toBeNull()
    // de는 Cohere 지원이므로 통과해야 함
    expect(localSttLanguage({ mode: 'single', languages: ['de'] })).toBe('de')
  })

  it('single은 첫 번째 언어만 본다 (지원 언어가 선두면 통과)', () => {
    expect(localSttLanguage({ mode: 'single', languages: ['ko', 'th'] })).toBe('ko')
  })
})
