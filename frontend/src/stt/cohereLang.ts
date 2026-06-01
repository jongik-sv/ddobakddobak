/**
 * Cohere 온디바이스 STT 언어 정책 (순수 함수).
 *
 * 로컬 모드(sherpa + Cohere int8)는 Cohere가 지원하는 언어 집합에 한해
 * 단일 언어(single) 회의에서만 동작한다. 그 외(다국어 multi, 미지원 ISO 등)는
 * null을 반환하여 호출측이 서버 STT로 폴백하도록 신호한다.
 */

/** Cohere int8 모델이 지원하는 언어 ISO 코드 집합. */
export const COHERE_LANGS = [
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
] as const

export type CohereLang = (typeof COHERE_LANGS)[number]

/** 주어진 ISO 코드가 Cohere 지원 언어인지 여부 (타입 가드). */
export function isCohereLang(lang: string): lang is CohereLang {
  return (COHERE_LANGS as readonly string[]).includes(lang)
}

/**
 * 로컬 STT가 사용할 언어를 결정한다.
 *
 * - single 모드 + 첫 번째 언어가 Cohere 지원 → 그 ISO 코드 반환.
 * - multi 모드 → null (다국어는 로컬 미지원, 서버 폴백).
 * - 빈 언어 배열 / 미지원 ISO(th 등) → null (서버 폴백).
 *
 * ddobak 언어 9개(ko,en,ja,zh,es,fr,de,th,vi) 중 th만 Cohere 미지원이므로
 * single 기준 실질 지원은 8개다.
 */
export function localSttLanguage(cfg: {
  mode: 'single' | 'multi'
  languages: string[]
}): string | null {
  if (cfg.mode !== 'single') return null

  const first = cfg.languages[0]
  if (typeof first !== 'string' || first.length === 0) return null

  return isCohereLang(first) ? first : null
}
