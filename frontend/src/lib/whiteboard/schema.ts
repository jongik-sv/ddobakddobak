export type WhiteboardTag = '확정' | '검토' | '미결'
export type ZoneKind = 'topic' | 'decision' | 'issue' | 'todo' | 'schedule'

export interface WhiteboardItem {
  text: string
  tag: WhiteboardTag | null
  who: string | null
  due: string | null
}
export interface WhiteboardZone {
  title: string
  kind: ZoneKind
  items: WhiteboardItem[]
}
export interface WhiteboardBoard {
  title: string
  date: string
  headline: string
  zones: WhiteboardZone[]
}

export const WHITEBOARD_TAGS: readonly WhiteboardTag[] = ['확정', '검토', '미결']
export const ZONE_KINDS: readonly ZoneKind[] = ['topic', 'decision', 'issue', 'todo', 'schedule']

const LIMITS = { title: 120, headline: 200, text: 300, person: 60, zones: 12, items: 20 } as const

/** 스키마 위반(재요청 대상). */
export class WhiteboardValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WhiteboardValidationError'
  }
}

function fail(msg: string): never {
  throw new WhiteboardValidationError(msg)
}

/** 앞뒤 공백·```json 펜스 제거 후 첫 `{`~마지막 `}`를 JSON.parse. 실패 시 format 오류. */
export function extractJson(text: string): unknown {
  let s = String(text ?? '').trim()
  s = s.replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/\n?```\s*$/, '').trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start < 0 || end <= start) fail('JSON 객체를 찾을 수 없음')
  try {
    return JSON.parse(s.slice(start, end + 1))
  } catch (e) {
    return fail(`JSON 파싱 실패: ${e instanceof Error ? e.message : String(e)}`)
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function reqString(obj: Record<string, unknown>, key: string, where: string, max: number): string {
  const v = obj[key]
  if (typeof v !== 'string') fail(`${where}.${key}가 문자열이 아님`)
  return v.trim().slice(0, max)
}

function optString(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim().slice(0, max)
  return t === '' ? null : t
}

export function validateBoard(raw: unknown): WhiteboardBoard {
  if (!isObject(raw)) fail('최상위 값이 객체가 아님')
  const title = reqString(raw, 'title', 'board', LIMITS.title)
  const date = reqString(raw, 'date', 'board', 40)
  const headline = reqString(raw, 'headline', 'board', LIMITS.headline)
  if (!Array.isArray(raw.zones) || raw.zones.length === 0) fail('zones가 비었거나 배열이 아님')

  // items 와 같은 순서: 빈 구역 제거 → 12개 절단 → 검증. (비객체 구역은 남겨 검증에서 걸리게 한다)
  const candidates = (raw.zones as unknown[])
    .filter((z) => !(isObject(z) && Array.isArray(z.items) && z.items.length === 0))
    .slice(0, LIMITS.zones)
  if (candidates.length === 0) fail('항목이 있는 구역이 없음')

  const zones: WhiteboardZone[] = []
  candidates.forEach((z: unknown, zi: number) => {
    const where = `zones[${zi}]`
    if (!isObject(z)) fail(`${where}가 객체가 아님`)
    const zTitle = reqString(z, 'title', where, LIMITS.title)
    if (typeof z.kind !== 'string' || !(ZONE_KINDS as readonly string[]).includes(z.kind)) {
      fail(`${where}.kind가 허용 값이 아님`)
    }
    if (!Array.isArray(z.items)) fail(`${where}.items가 배열이 아님`)
    const items: WhiteboardItem[] = []
    z.items.slice(0, LIMITS.items).forEach((it: unknown, ii: number) => {
      const iw = `${where}.items[${ii}]`
      if (!isObject(it)) fail(`${iw}가 객체가 아님`)
      const text = reqString(it, 'text', iw, LIMITS.text)
      if (text === '') fail(`${iw}.text가 빈 문자열`)
      let tag: WhiteboardTag | null = null
      if (it.tag !== undefined && it.tag !== null) {
        if (typeof it.tag !== 'string' || !(WHITEBOARD_TAGS as readonly string[]).includes(it.tag)) {
          fail(`${iw}.tag가 허용 값이 아님`)
        }
        tag = it.tag as WhiteboardTag
      }
      items.push({ text, tag, who: optString(it.who, LIMITS.person), due: optString(it.due, LIMITS.person) })
    })
    if (items.length > 0) zones.push({ title: zTitle, kind: z.kind as ZoneKind, items })
  })
  if (zones.length === 0) fail('항목이 있는 구역이 없음')
  return { title, date, headline, zones }
}

/** extractJson + validateBoard. 실패 시 WhiteboardValidationError. */
export function parseBoardResponse(text: string): WhiteboardBoard {
  return validateBoard(extractJson(text))
}
