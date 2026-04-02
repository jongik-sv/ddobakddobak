import { describe, it, expect, beforeEach } from 'vitest'

// config.ts는 모듈 로드 시 config.yaml을 파싱하므로,
// 테스트에서는 동적 함수만 테스트한다 (getMode, getServerUrl, getApiBaseUrl, getWsUrl).
// 모듈을 매 테스트마다 재로드하면 config.yaml mock이 필요해지므로,
// 함수들을 직접 import하여 localStorage 기반 분기를 검증한다.

describe('config 동적 함수', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  describe('getMode', () => {
    it('localStorage에 mode가 없으면 "local"을 반환한다', async () => {
      const { getMode } = await import('../config')
      expect(getMode()).toBe('local')
    })

    it('localStorage에 mode=server이면 "server"를 반환한다', async () => {
      localStorage.setItem('mode', 'server')
      const { getMode } = await import('../config')
      expect(getMode()).toBe('server')
    })

    it('localStorage에 mode=local이면 "local"을 반환한다', async () => {
      localStorage.setItem('mode', 'local')
      const { getMode } = await import('../config')
      expect(getMode()).toBe('local')
    })

    it('localStorage에 유효하지 않은 mode값이면 "local"을 반환한다', async () => {
      localStorage.setItem('mode', 'invalid')
      const { getMode } = await import('../config')
      expect(getMode()).toBe('local')
    })
  })

  describe('getServerUrl', () => {
    it('localStorage에 server_url이 없으면 빈 문자열을 반환한다', async () => {
      const { getServerUrl } = await import('../config')
      expect(getServerUrl()).toBe('')
    })

    it('localStorage에 server_url이 있으면 해당 값을 반환한다', async () => {
      localStorage.setItem('server_url', 'https://api.example.com')
      const { getServerUrl } = await import('../config')
      expect(getServerUrl()).toBe('https://api.example.com')
    })
  })

  describe('getApiBaseUrl', () => {
    it('로컬 모드일 때 기존 로직의 URL을 반환한다', async () => {
      localStorage.setItem('mode', 'local')
      const { getApiBaseUrl } = await import('../config')
      const url = getApiBaseUrl()
      // 로컬 모드: IS_TAURI가 false(jsdom 환경)이므로 env 또는 config.yaml의 base_url
      expect(url).toContain('/api/v1')
    })

    it('서버 모드 + server_url 설정 시 server_url 기반 API URL을 반환한다', async () => {
      localStorage.setItem('mode', 'server')
      localStorage.setItem('server_url', 'https://api.example.com')
      const { getApiBaseUrl } = await import('../config')
      expect(getApiBaseUrl()).toBe('https://api.example.com/api/v1')
    })

    it('서버 모드 + server_url 미설정 시 기본 localhost URL을 반환한다', async () => {
      localStorage.setItem('mode', 'server')
      const { getApiBaseUrl } = await import('../config')
      expect(getApiBaseUrl()).toBe('http://127.0.0.1:13323/api/v1')
    })
  })

  describe('getWsUrl', () => {
    it('서버 모드 + https URL 시 wss 프로토콜 + /cable 경로를 반환한다', async () => {
      localStorage.setItem('mode', 'server')
      localStorage.setItem('server_url', 'https://api.example.com')
      const { getWsUrl } = await import('../config')
      expect(getWsUrl()).toBe('wss://api.example.com/cable')
    })

    it('서버 모드 + http URL 시 ws 프로토콜 + /cable 경로를 반환한다', async () => {
      localStorage.setItem('mode', 'server')
      localStorage.setItem('server_url', 'http://192.168.1.100:3000')
      const { getWsUrl } = await import('../config')
      expect(getWsUrl()).toBe('ws://192.168.1.100:3000/cable')
    })

    it('서버 모드 + server_url 미설정 시 기본 localhost WS URL을 반환한다', async () => {
      localStorage.setItem('mode', 'server')
      const { getWsUrl } = await import('../config')
      // server_url이 없으면 기존 fallback 로직
      expect(getWsUrl()).toContain('/cable')
    })
  })
})
