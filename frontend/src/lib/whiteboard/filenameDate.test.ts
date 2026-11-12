import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildWhiteboardFilename, buildWhiteboardMaterial, formatFilenameDate } from './material'

describe('파일명 날짜는 로컬 기준', () => {
  const prev = process.env.TZ
  beforeAll(() => {
    process.env.TZ = 'Asia/Seoul'
  })
  afterAll(() => {
    if (prev === undefined) delete process.env.TZ
    else process.env.TZ = prev
  })

  it('TZ 가 실제로 적용된다(전제)', () => {
    expect(new Date('2026-07-14T20:00:00Z').getDate()).toBe(15)
  })
  it('UTC ISO 를 로컬(서울) 날짜로 바꾼다', () => {
    expect(formatFilenameDate('2026-07-14T20:00:00Z')).toBe('2026-07-15')
    expect(formatFilenameDate('2026-07-14T20:00:00.000+00:00')).toBe('2026-07-15')
    expect(buildWhiteboardFilename('주간', '2026-07-14T20:00:00Z')).toBe('주간_2026-07-15.html')
  })
  it('Date 객체도 로컬 날짜', () => {
    expect(formatFilenameDate(new Date('2026-07-14T20:00:00Z'))).toBe('2026-07-15')
  })
  it('타임존 없는 날짜는 쓰인 그대로', () => {
    expect(formatFilenameDate('2026-07-14')).toBe('2026-07-14')
    expect(formatFilenameDate('2026-07-14T20:00:00')).toBe('2026-07-14')
  })
  it('해석 불가면 미정을 유지하고 오늘로 바꾸지 않는다', () => {
    expect(formatFilenameDate('미정')).toBe('미정')
    expect(formatFilenameDate(new Date('x'))).toBe('미정')
  })
  it('없으면 오늘(로컬) 형식', () => {
    expect(formatFilenameDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
  it('material 날짜도 UTC ISO 를 로컬로 바꾼다', () => {
    const m = buildWhiteboardMaterial({
      meeting: { id: 1, title: 't', date: '2026-07-14T20:00:00Z', start_time: '2026-07-14T20:00:00Z' },
      summary: { type: 'notes_markdown', notes_markdown: '## a\n- b' },
      transcripts: [],
    } as never)
    expect(m?.date).toBe('2026-07-15')
    expect(m?.datetime).toBe('2026-07-15 05:00')
  })
})
