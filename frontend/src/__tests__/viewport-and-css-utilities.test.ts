import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const INDEX_HTML = fs.readFileSync(
  path.resolve(__dirname, '../../index.html'),
  'utf-8',
)
const INDEX_CSS = fs.readFileSync(
  path.resolve(__dirname, '../index.css'),
  'utf-8',
)

describe('TSK-00-01: viewport meta 및 CSS 유틸리티 추가', () => {
  describe('index.html viewport meta', () => {
    it('viewport meta에 viewport-fit=cover가 포함되어야 한다', () => {
      expect(INDEX_HTML).toMatch(/viewport-fit\s*=\s*cover/)
    })
  })

  describe('index.css CSS 유틸리티', () => {
    it('h-dvh 유틸리티가 정의되어야 한다', () => {
      // Tailwind v4 @utility 디렉티브로 h-dvh 정의
      expect(INDEX_CSS).toMatch(/@utility\s+h-dvh/)
      expect(INDEX_CSS).toMatch(/100dvh/)
    })

    it('pb-safe 유틸리티가 정의되어야 한다 (safe-area-inset-bottom)', () => {
      expect(INDEX_CSS).toMatch(/@utility\s+pb-safe/)
      expect(INDEX_CSS).toMatch(/safe-area-inset-bottom/)
    })

    it('pt-safe 유틸리티가 정의되어야 한다 (safe-area-inset-top)', () => {
      expect(INDEX_CSS).toMatch(/@utility\s+pt-safe/)
      expect(INDEX_CSS).toMatch(/safe-area-inset-top/)
    })

    it('animate-slide-in-left 키프레임 애니메이션이 정의되어야 한다', () => {
      expect(INDEX_CSS).toMatch(/@keyframes\s+slide-in-left/)
      expect(INDEX_CSS).toMatch(/@utility\s+animate-slide-in-left/)
    })

    it('overscroll-behavior: none이 전역 적용되어야 한다', () => {
      expect(INDEX_CSS).toMatch(/overscroll-behavior\s*:\s*none/)
    })

    it('@media (hover: hover) 호버 분기 유틸리티가 추가되어야 한다', () => {
      expect(INDEX_CSS).toMatch(/@media\s*\(\s*hover\s*:\s*hover\s*\)/)
    })
  })
})
