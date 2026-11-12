import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import {
  WHITEBOARD_SYSTEM_PROMPT,
  WHITEBOARD_PROMPT_VERSION,
  buildWhiteboardUserContent,
  buildRetrySuffix,
  buildCopyInstruction,
  buildWhiteboardMaterial,
  buildWhiteboardFilename,
  extractJson,
  validateBoard,
  parseBoardResponse,
  WhiteboardValidationError,
  renderBoardHtml,
  classifyWhiteboardFailure,
  resolveWhiteboardRoute,
} from './index'
import type { MeetingExportData } from '../../api/meetings/types'

const PROMPT_SHA256 = 'c39e2509ea6c23b27f38c292e6939dd99b5f10749e97c129c9757678ea04f6a6'

function exportData(over: Partial<MeetingExportData> = {}): MeetingExportData {
  return {
    meeting: { id: 1, title: '주간 회의', date: '2026-11-12', start_time: '2026-11-12 09:30', end_time: '', status: 'completed', creator_name: 'a' },
    summary: { type: 'notes_markdown', notes_markdown: '## 요약\n- 내용' },
    transcripts: [],
    ...over,
  }
}

const validBoard = () => ({
  title: 'T',
  date: '2026-11-12',
  headline: 'H',
  zones: [{ title: 'Z', kind: 'decision', items: [{ text: 'x', tag: '확정', who: null, due: null }] }],
})

describe('prompt', () => {
  it('시스템 프롬프트 sha256 고정', () => {
    expect(createHash('sha256').update(WHITEBOARD_SYSTEM_PROMPT, 'utf8').digest('hex')).toBe(PROMPT_SHA256)
    expect(WHITEBOARD_PROMPT_VERSION).toBe('wb-v1')
  })
  it('사용자 입력/재요청/복사 지시문', () => {
    const m = { title: '제목', date: '2026-11-12', datetime: '2026-11-12 09:30', markdown: 'MD' }
    expect(buildWhiteboardUserContent(m)).toBe('[회의] 제목\n[일시] 2026-11-12 09:30\n[AI 회의록]\nMD')
    expect(buildRetrySuffix('err')).toBe('\n\n[이전 응답 오류] 직전 응답이 스키마를 벗어났다: err. 스키마에 맞는 JSON 객체 하나만 다시 출력하라.')
    const c = buildCopyInstruction(m, 'f.html')
    expect(c).toBe([
      '아래 회의록으로 Claude 아티팩트 화이트보드 한 장을 만들어 줘.',
      '- 화이트보드(Whiteboard) 아티팩트로 만들어 줘. 화이트보드 타입이 없으면 지금 쓸 수 있는 아티팩트로 만들되, 반드시 아티팩트로 만들어 줘.',
      '- 다 만들면 내가 내려받을 수 있게 다운로드까지 제공해 줘 (파일 이름: f)',
      '- 주제별 구역에 스티커처럼 배치',
      '- 결정은 확정·검토·미결 태그로 구분',
      '- 할 일 구역에 담당자·기한 표시',
      '- 확정·검토·미결로 거를 수 있게, 다크 모드 지원',
      '- 회의록에 없는 내용은 만들지 말 것',
      '',
      '[회의] 제목',
      '[일시] 2026-11-12 09:30',
      '[AI 회의록]',
      'MD',
    ].join('\n'))
    expect(c).toContain('화이트보드(Whiteboard) 아티팩트')
    expect(c).not.toMatch(/html/i)
    expect(c).toContain('반드시 아티팩트로')
    expect(c).toContain('다운로드')
    expect(c).toContain('(파일 이름: f)')
    expect(c).not.toContain('f.html')
    expect(c).toContain('다크 모드 지원')
  })
})

describe('material', () => {
  it('notes_markdown 그대로', () => {
    const m = buildWhiteboardMaterial(exportData())!
    expect(m.markdown).toBe('## 요약\n- 내용')
    expect(m.datetime).toBe('2026-11-12 09:30')
    expect(m.title).toBe('주간 회의')
  })
  it('json_fields 합성', () => {
    const m = buildWhiteboardMaterial(exportData({ summary: { type: 'json_fields', key_points: ['a'], decisions: [], discussion_details: ['c', 'd'] } }))!
    expect(m.markdown).toBe('## 핵심 요약\n- a\n\n## 상세 논의\n- c\n- d')
  })
  it('요약 없음/빈 값은 null', () => {
    expect(buildWhiteboardMaterial(exportData({ summary: null }))).toBeNull()
    expect(buildWhiteboardMaterial(exportData({ summary: { type: 'json_fields', key_points: [], decisions: [] } }))).toBeNull()
    expect(buildWhiteboardMaterial(exportData({ summary: { type: 'notes_markdown', notes_markdown: '  ' } }))).toBeNull()
  })
  it('날짜 미정 유지', () => {
    const d = exportData()
    d.meeting.date = ''
    const m = buildWhiteboardMaterial(d)!
    expect(m.date).toBe('미정')
    expect(m.datetime).toBe('미정')
    expect(buildWhiteboardFilename('a b/c', undefined)).toBe('a_bc_미정.html')
    expect(buildWhiteboardFilename('t', '2026-11-12')).toBe('t_2026-11-12.html')
  })
})

describe('schema', () => {
  it('펜스 제거', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(extractJson('  설명 {"a":1} 끝 ')).toEqual({ a: 1 })
  })
  it('파싱 실패는 format 오류', () => {
    expect(() => extractJson('없음')).toThrow(WhiteboardValidationError)
    expect(() => extractJson('{bad}')).toThrow(WhiteboardValidationError)
  })
  it('성공', () => {
    expect(validateBoard(validBoard()).zones[0].items[0].tag).toBe('확정')
  })
  it('실패 케이스', () => {
    const b = validBoard()
    expect(() => validateBoard(null)).toThrow()
    expect(() => validateBoard([])).toThrow()
    expect(() => validateBoard({ ...b, zones: [] })).toThrow()
    expect(() => validateBoard({ ...b, zones: 'x' })).toThrow()
    expect(() => validateBoard({ ...b, title: 1 })).toThrow()
    expect(() => validateBoard({ ...b, zones: [{ title: 'Z', kind: 'bad', items: [{ text: 'x' }] }] })).toThrow()
    expect(() => validateBoard({ ...b, zones: [{ title: 'Z', kind: 'topic', items: [{ text: 'x', tag: '몰라' }] }] })).toThrow()
    expect(() => validateBoard({ ...b, zones: [{ title: 'Z', kind: 'topic', items: [{ text: '  ' }] }] })).toThrow()
    expect(() => validateBoard({ ...b, zones: [{ title: 'Z', kind: 'topic', items: [] }] })).toThrow()
  })
  it('관대 처리', () => {
    const long = 'a'.repeat(500)
    const r = validateBoard({
      title: ` ${long} `, date: '2026-11-12', headline: long,
      zones: [
        { title: 'E', kind: 'topic', items: [] },
        { title: 'Z', kind: 'todo', items: Array.from({ length: 25 }, () => ({ text: long, who: '  ', due: long })) },
        ...Array.from({ length: 20 }, () => ({ title: 'Q', kind: 'topic', items: [{ text: 'x' }] })),
      ],
    })
    expect(r.title.length).toBe(120)
    expect(r.headline.length).toBe(200)
    expect(r.zones.length).toBe(12)
    expect(r.zones[0].title).toBe('Z')
    expect(r.zones[0].items.length).toBe(20)
    expect(r.zones[0].items[0]).toEqual({ text: 'a'.repeat(300), tag: null, who: null, due: 'a'.repeat(60) })
  })
  it('parseBoardResponse', () => {
    expect(parseBoardResponse('```json\n' + JSON.stringify(validBoard()) + '\n```').title).toBe('T')
  })
})

describe('render', () => {
  const evil = '<script>alert(1)</script>"\'&'
  const html = renderBoardHtml(
    validateBoard({
      title: evil, date: evil, headline: evil,
      zones: [{ title: evil, kind: 'todo', items: [{ text: evil, tag: '확정', who: evil, due: evil }] }],
    }),
  )
  it('데이터는 실행 가능 형태로 남지 않는다', () => {
    expect(html).not.toContain('<script>alert(1)')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;&quot;&#39;&amp;')
    expect((html.match(/<script/g) ?? []).length).toBe(1)
    expect(html).not.toContain('alert(1)</script>')
  })
  it('CSP meta, 외부 리소스 없음, 푸터, 다크 모드', () => {
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline'; img-src data:">`)
    const urls = html.match(/https?:\/\/[^"'\s)]+/g) ?? []
    expect(urls.every((u) => /^https:\/\/fonts\.(googleapis|gstatic)\.com/.test(u))).toBe(true)
    expect(html).toContain('또박또박 AI 회의록으로 생성 · ')
    expect(html).toContain('prefers-color-scheme')
    expect(html).toContain('data-theme')
    for (const l of ['전체', '확정', '검토', '미결']) expect(html).toContain(`>${l}</button>`)
  })
})

describe('failure', () => {
  it('분류', () => {
    expect(classifyWhiteboardFailure({ kind: 'exit', message: 'x', stderr_tail: 'Please run /login' }).kind).toBe('auth')
    expect(classifyWhiteboardFailure({ kind: 'exit', message: 'x', stdout_tail: 'Usage limit reached' }).kind).toBe('rate_limit')
    expect(classifyWhiteboardFailure(new WhiteboardValidationError('v')).kind).toBe('format')
    expect(classifyWhiteboardFailure('x', { format: true }).kind).toBe('format')
    expect(classifyWhiteboardFailure({ kind: 'timeout', message: '' }).kind).toBe('timeout')
    expect(classifyWhiteboardFailure({ kind: 'not_found', message: '' }).kind).toBe('not_found')
    const u = classifyWhiteboardFailure({ kind: 'exit', message: '이상한   오류' })
    expect(u.kind).toBe('unknown')
    expect(u.message).toBe('화이트보드를 만들지 못했습니다: 이상한 오류')
  })
})

describe('route', () => {
  const base = { isTauri: false, localClaude: null, webMode: 'copy' as const, serverClaudeAvailable: false, serverEnabled: true }
  it('5분기', () => {
    expect(resolveWhiteboardRoute({ ...base, isTauri: true, localClaude: '/bin/claude' })).toBe('local') // 1
    expect(resolveWhiteboardRoute({ ...base, isTauri: true, webMode: 'server_claude', serverClaudeAvailable: true })).toBe('server') // 2→4
    expect(resolveWhiteboardRoute(base)).toBe('copy') // 3
    expect(resolveWhiteboardRoute({ ...base, webMode: 'server_claude', serverClaudeAvailable: true })).toBe('server') // 4
    expect(resolveWhiteboardRoute({ ...base, webMode: 'server_claude', serverClaudeAvailable: false })).toBe('copy') // 5
  })
  it('설정 실패·1단계는 copy', () => {
    expect(resolveWhiteboardRoute({ ...base, webMode: null, serverClaudeAvailable: null })).toBe('copy')
    expect(resolveWhiteboardRoute({ ...base, webMode: 'server_claude', serverClaudeAvailable: true, serverEnabled: false })).toBe('copy')
  })
})

describe('validateBoard zones 절단 순서', () => {
  const zone = (n: number, empty = false) => ({
    title: `z${n}`, kind: 'topic',
    items: empty ? [] : [{ text: `t${n}`, tag: null, who: null, due: null }],
  })
  const wrap = (zones: unknown[]) => ({ title: 't', date: '2026-11-12', headline: 'h', zones })

  it('빈 구역을 먼저 빼고 12개로 자른다', () => {
    const zones = [zone(0, true), zone(1, true), ...Array.from({ length: 13 }, (_, i) => zone(i + 2))]
    const b = validateBoard(wrap(zones))
    expect(b.zones).toHaveLength(12)
    expect(b.zones[0].title).toBe('z2')
  })

  it('12개 뒤의 잘못된 구역은 검증하지 않는다', () => {
    const zones = [...Array.from({ length: 12 }, (_, i) => zone(i)), { title: 'bad', kind: 'nope', items: [] }, { title: 'bad2', kind: 'nope', items: [{}] }]
    expect(validateBoard(wrap(zones)).zones).toHaveLength(12)
  })

  it('전부 빈 구역이면 오류', () => {
    expect(() => validateBoard(wrap([zone(0, true)]))).toThrow(WhiteboardValidationError)
  })
})
