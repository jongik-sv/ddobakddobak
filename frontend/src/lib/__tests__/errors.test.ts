import { describe, it, expect } from 'vitest'
import { HTTPError } from 'ky'
import { errorToMessage, isMeetingRedactedError } from '../errors'

function makeHttpError(body: unknown): HTTPError {
  const response = new Response(JSON.stringify(body), {
    status: 422,
    headers: { 'Content-Type': 'application/json' },
  })
  const request = new Request('http://localhost/test')
  // ky HTTPError(response, request, options)
  return new HTTPError(response, request, {} as never)
}

describe('errorToMessage', () => {
  it('HTTPError 본문의 error 필드를 우선 사용한다', async () => {
    const err = makeHttpError({ error: '권한이 없습니다.' })
    expect(await errorToMessage(err, 'fallback')).toBe('권한이 없습니다.')
  })

  it('error가 없으면 errors 배열을 쉼표로 결합한다', async () => {
    const err = makeHttpError({ errors: ['이름 필수', '이메일 중복'] })
    expect(await errorToMessage(err, 'fallback')).toBe('이름 필수, 이메일 중복')
  })

  it('본문이 비었으면 fallback을 반환한다', async () => {
    const err = makeHttpError({})
    expect(await errorToMessage(err, 'fallback')).toBe('fallback')
  })

  it('JSON 파싱 실패 시 fallback을 반환한다', async () => {
    const response = new Response('not json', { status: 500 })
    const err = new HTTPError(response, new Request('http://localhost/test'), {} as never)
    expect(await errorToMessage(err, 'fallback')).toBe('fallback')
  })

  it('일반 Error는 message를 사용한다', async () => {
    expect(await errorToMessage(new Error('네트워크 오류'), 'fallback')).toBe('네트워크 오류')
  })

  it('알 수 없는 값은 fallback을 반환한다', async () => {
    expect(await errorToMessage('nope', 'fallback')).toBe('fallback')
    expect(await errorToMessage(null, 'fallback')).toBe('fallback')
  })
})

describe('isMeetingRedactedError', () => {
  it('ky HTTPError의 code가 meeting_redacted면 true다', async () => {
    const err = makeHttpError({ error: '기밀 절단이 적용된 회의입니다.', code: 'meeting_redacted' })
    expect(await isMeetingRedactedError(err)).toBe(true)
  })

  it('ky HTTPError라도 code가 다르면(재시도 가능한 409 등) false다', async () => {
    const err = makeHttpError({ error: '다른 기기에서 녹음이 진행 중입니다.', code: 'recorder_conflict' })
    expect(await isMeetingRedactedError(err)).toBe(false)
  })

  it('raw fetch 헬퍼가 .code를 부착해 던진 Error도 true로 판정한다', async () => {
    const err = Object.assign(new Error('기밀 절단이 적용된 회의입니다.'), { code: 'meeting_redacted' })
    expect(await isMeetingRedactedError(err)).toBe(true)
  })

  it('.code가 없는 일반 Error는 false다', async () => {
    expect(await isMeetingRedactedError(new Error('network'))).toBe(false)
  })
})
