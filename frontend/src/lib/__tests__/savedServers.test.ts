import { describe, it, expect, beforeEach } from 'vitest'
import {
  loadSavedServers,
  upsertOnConnect,
  upsertServerMeta,
  removeSavedServer,
  displayHost,
  displayPort,
  DEFAULT_PORT,
} from '../savedServers'

const KEY = 'recent_servers'

describe('loadSavedServers', () => {
  beforeEach(() => localStorage.clear())

  it('빈 저장소면 빈 배열', () => {
    expect(loadSavedServers()).toEqual([])
  })

  it('구버전 string[] 을 객체로 마이그레이션한다', () => {
    localStorage.setItem(KEY, JSON.stringify(['http://192.168.0.10:13323', 'http://10.0.0.5:8080']))
    const list = loadSavedServers()
    expect(list).toHaveLength(2)
    expect(list[0]).toMatchObject({ url: 'http://192.168.0.10:13323', lastConnectedAt: 0 })
    expect(list[0].name).toBeUndefined()
  })

  it('객체 형태는 그대로 로드하고 lastConnectedAt 내림차순 정렬', () => {
    localStorage.setItem(KEY, JSON.stringify([
      { url: 'http://a:13323', lastConnectedAt: 100 },
      { url: 'http://b:13323', name: '집', lastConnectedAt: 300 },
      { url: 'http://c:13323', lastConnectedAt: 200 },
    ]))
    const list = loadSavedServers()
    expect(list.map((s) => s.url)).toEqual(['http://b:13323', 'http://c:13323', 'http://a:13323'])
    expect(list[0].name).toBe('집')
  })

  it('손상된 JSON 이면 빈 배열', () => {
    localStorage.setItem(KEY, '{not json')
    expect(loadSavedServers()).toEqual([])
  })

  it('url 없는 항목은 버린다', () => {
    localStorage.setItem(KEY, JSON.stringify([{ name: 'x', lastConnectedAt: 1 }, { url: 'http://ok:13323', lastConnectedAt: 2 }]))
    expect(loadSavedServers().map((s) => s.url)).toEqual(['http://ok:13323'])
  })
})

describe('upsertOnConnect', () => {
  beforeEach(() => localStorage.clear())

  it('신규 url 을 추가하고 lastConnectedAt 을 채운다', () => {
    const before = Date.now()
    const list = upsertOnConnect('http://192.168.0.10:13323')
    expect(list).toHaveLength(1)
    expect(list[0].url).toBe('http://192.168.0.10:13323')
    expect(list[0].lastConnectedAt).toBeGreaterThanOrEqual(before)
  })

  it('기존 url 의 name/location 을 보존하고 lastConnectedAt 만 갱신', () => {
    localStorage.setItem(KEY, JSON.stringify([
      { url: 'http://a:13323', name: '사무실', location: '회의실', lastConnectedAt: 1 },
    ]))
    const list = upsertOnConnect('http://a:13323')
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ name: '사무실', location: '회의실' })
    expect(list[0].lastConnectedAt).toBeGreaterThan(1)
  })

  it('최근 접속이 맨 앞에 온다', () => {
    upsertOnConnect('http://a:13323')
    const list = upsertOnConnect('http://b:13323')
    expect(list[0].url).toBe('http://b:13323')
  })

  it('11개째부터 가장 오래된 항목이 밀려난다 (캡 10)', () => {
    for (let i = 0; i < 11; i++) upsertOnConnect(`http://h${i}:13323`)
    const list = loadSavedServers()
    expect(list).toHaveLength(10)
    expect(list.some((s) => s.url === 'http://h0:13323')).toBe(false)
  })
})

describe('upsertServerMeta', () => {
  beforeEach(() => localStorage.clear())

  it('기존 항목의 이름/위치를 갱신한다', () => {
    upsertOnConnect('http://a:13323')
    const list = upsertServerMeta('http://a:13323', { name: '집', location: '서재' })
    expect(list[0]).toMatchObject({ name: '집', location: '서재' })
  })

  it('빈 문자열 patch 는 undefined 로 정리한다', () => {
    localStorage.setItem(KEY, JSON.stringify([{ url: 'http://a:13323', name: 'x', lastConnectedAt: 1 }]))
    const list = upsertServerMeta('http://a:13323', { name: '', location: '' })
    expect(list[0].name).toBeUndefined()
    expect(list[0].location).toBeUndefined()
  })

  it('없는 url 이면 미접속(lastConnectedAt=0) 항목으로 새로 만든다', () => {
    const list = upsertServerMeta('http://new:13323', { name: '신규', location: '창고' })
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ url: 'http://new:13323', name: '신규', location: '창고', lastConnectedAt: 0 })
  })

  it('새 항목에 빈 메타만 주면 name/location 은 undefined', () => {
    const list = upsertServerMeta('http://new:13323', { name: '', location: '' })
    expect(list[0]).toMatchObject({ url: 'http://new:13323', lastConnectedAt: 0 })
    expect(list[0].name).toBeUndefined()
    expect(list[0].location).toBeUndefined()
  })

  it('새로 만든 미접속 항목은 접속 시 lastConnectedAt 이 갱신되며 메타 보존', () => {
    upsertServerMeta('http://a:13323', { name: '집' })
    const list = upsertOnConnect('http://a:13323')
    expect(list[0].name).toBe('집')
    expect(list[0].lastConnectedAt).toBeGreaterThan(0)
  })
})

describe('removeSavedServer', () => {
  beforeEach(() => localStorage.clear())

  it('해당 url 을 제거한다', () => {
    upsertOnConnect('http://a:13323')
    upsertOnConnect('http://b:13323')
    const list = removeSavedServer('http://a:13323')
    expect(list.map((s) => s.url)).toEqual(['http://b:13323'])
  })
})

describe('display helpers', () => {
  it('displayHost 는 호스트만 반환', () => {
    expect(displayHost('http://192.168.0.10:13323')).toBe('192.168.0.10')
    expect(displayHost('https://example.com:8080')).toBe('example.com')
  })

  it('displayPort 는 기본포트면 null', () => {
    expect(displayPort(`http://192.168.0.10:${DEFAULT_PORT}`)).toBeNull()
  })

  it('displayPort 는 비기본포트면 문자열', () => {
    expect(displayPort('http://10.0.0.5:8080')).toBe('8080')
  })

  it('파싱 불가 url 은 host=원문, port=null', () => {
    expect(displayHost('garbage')).toBe('garbage')
    expect(displayPort('garbage')).toBeNull()
  })
})
