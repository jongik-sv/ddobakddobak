import { describe, it, expect, beforeEach } from 'vitest'

// config.ts는 모듈 로드 시 config.yaml을 파싱하므로,
// 테스트에서는 동적 함수만 테스트한다 (getMode, getServerUrl, getApiBaseUrl, getWsUrl).
// 모드는 플랫폼이 결정한다: jsdom 환경은 웹 브라우저(IS_TAURI=false, IS_MOBILE=false)이므로
// getMode()는 localStorage와 무관하게 항상 'server'이고, API/WS는 동일 origin을 쓴다.

describe('config 동적 함수', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  describe('getMode', () => {
    it('웹 환경에서는 localStorage와 무관하게 "server"를 반환한다', async () => {
      const { getMode } = await import('../config')
      expect(getMode()).toBe('server')
    })

    it('웹 환경에서는 localStorage에 mode=local이어도 "server"를 반환한다', async () => {
      localStorage.setItem('mode', 'local')
      const { getMode } = await import('../config')
      expect(getMode()).toBe('server')
    })
  })

  describe('getServerUrl', () => {
    it('localStorage에 server_url이 없으면 config.yaml의 default_server_url로 폴백한다', async () => {
      const { getServerUrl, getDefaultServerUrl } = await import('../config')
      expect(getServerUrl()).toBe(getDefaultServerUrl())
    })

    it('localStorage에 server_url이 있으면 해당 값을 반환한다', async () => {
      localStorage.setItem('server_url', 'https://api.example.com')
      const { getServerUrl } = await import('../config')
      expect(getServerUrl()).toBe('https://api.example.com')
    })
  })

  describe('getApiBaseUrl', () => {
    it('웹(server 모드)에서는 페이지와 동일 origin의 /api/v1을 반환한다', async () => {
      const { getApiBaseUrl } = await import('../config')
      expect(getApiBaseUrl()).toBe(`${window.location.origin}/api/v1`)
    })

    it('웹에서는 server_url을 설정해도 동일 origin을 사용한다(서버주소 무시)', async () => {
      localStorage.setItem('server_url', 'https://api.example.com')
      const { getApiBaseUrl } = await import('../config')
      expect(getApiBaseUrl()).toBe(`${window.location.origin}/api/v1`)
    })
  })

  describe('getApiOrigin', () => {
    it('웹(server 모드)에서는 경로 접미사 없는 페이지 origin을 반환한다', async () => {
      const { getApiOrigin } = await import('../config')
      expect(getApiOrigin()).toBe(window.location.origin)
      expect(getApiOrigin().endsWith('/api/v1')).toBe(false)
    })

    it('getApiBaseUrl은 getApiOrigin + /api/v1 이다 (probe_url bare-origin 계약과 정합)', async () => {
      const { getApiOrigin, getApiBaseUrl } = await import('../config')
      expect(getApiBaseUrl()).toBe(`${getApiOrigin()}/api/v1`)
    })
  })

  describe('getWsUrl', () => {
    it('웹(server 모드)에서는 동일 origin 기반 ws(s) + /cable을 반환한다', async () => {
      const { getWsUrl } = await import('../config')
      const expected = window.location.origin.replace(/^http/, 'ws') + '/cable'
      expect(getWsUrl()).toBe(expected)
    })

    it('웹에서는 server_url을 설정해도 동일 origin 기반 WS를 사용한다', async () => {
      localStorage.setItem('server_url', 'https://api.example.com')
      const { getWsUrl } = await import('../config')
      const expected = window.location.origin.replace(/^http/, 'ws') + '/cable'
      expect(getWsUrl()).toBe(expected)
    })
  })
})
