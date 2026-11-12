import type { MeetingExportData } from '../../api/meetings/types'

export interface WhiteboardMaterial {
  title: string
  /** YYYY-MM-DD, 알 수 없으면 "미정" */
  date: string
  /** "YYYY-MM-DD HH:MM", 시각을 모르면 date만 */
  datetime: string
  markdown: string
}

const UNDECIDED = '미정'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * 날짜 문자열 → YYYY-MM-DD. 시각+타임존(Z·+09:00)이 붙은 ISO 는 브라우저 로컬 날짜로 바꾼다
 * (UTC 앞 10자를 자르면 한국 새벽·밤 시각의 날짜가 하루 어긋난다). 타임존 없는 값은 쓰인 날짜 그대로.
 * 해석할 수 없으면 "미정".
 */
function normalizeDate(raw: string | undefined | null): string {
  if (!raw) return UNDECIDED
  const s = raw.trim()
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (!m) return UNDECIDED
  if (/^\d{4}-\d{2}-\d{2}[T ].*(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const d = new Date(s)
    if (!Number.isNaN(d.getTime())) return localYmd(d)
  }
  return `${m[1]}-${m[2]}-${m[3]}`
}

/**
 * 내보내기 파일명용 날짜. date 가 없으면 오늘(로컬), Date 면 로컬 날짜, 문자열이면 normalizeDate,
 * 해석 불가("미정" 등)면 "미정" 유지 — 오늘 날짜로 대체하지 않는다.
 */
export function formatFilenameDate(date?: string | Date | null): string {
  if (date === undefined || date === null || date === '') return localYmd(new Date())
  if (date instanceof Date) return Number.isNaN(date.getTime()) ? UNDECIDED : localYmd(date)
  return normalizeDate(date)
}

function extractTime(raw: string | undefined | null): string | null {
  if (!raw) return null
  const s = raw.trim()
  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(s)) {
    const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(s)
    if (hasZone) {
      const d = new Date(s)
      if (!Number.isNaN(d.getTime())) return `${pad(d.getHours())}:${pad(d.getMinutes())}`
    }
    const m = /[T ](\d{2}):(\d{2})/.exec(s)
    return m ? `${m[1]}:${m[2]}` : null
  }
  const m = /^(\d{1,2}):(\d{2})/.exec(s)
  return m ? `${pad(Number(m[1]))}:${m[2]}` : null
}

function bullets(items: string[] | undefined): string {
  return (items ?? [])
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean)
    .map((s) => `- ${s}`)
    .join('\n')
}

function summaryToMarkdown(summary: NonNullable<MeetingExportData['summary']>): string {
  if (summary.type === 'notes_markdown') {
    return (summary.notes_markdown ?? '').trim() ? (summary.notes_markdown as string) : ''
  }
  const sections: Array<[string, string]> = [
    ['핵심 요약', bullets(summary.key_points)],
    ['결정 사항', bullets(summary.decisions)],
    ['상세 논의', bullets(summary.discussion_details)],
  ]
  return sections
    .filter(([, body]) => body)
    .map(([head, body]) => `## ${head}\n${body}`)
    .join('\n\n')
}

/** 요약이 없거나 비어 있으면 null (화이트보드 버튼 비활성 조건). */
export function buildWhiteboardMaterial(data: MeetingExportData): WhiteboardMaterial | null {
  if (!data.summary) return null
  const markdown = summaryToMarkdown(data.summary)
  if (!markdown.trim()) return null
  const date = normalizeDate(data.meeting.date)
  const time = extractTime(data.meeting.start_time)
  const datetime = date !== UNDECIDED && time ? `${date} ${time}` : date
  return { title: data.meeting.title ?? '', date, datetime, markdown }
}

/** buildExportFilename 규칙(제목 정리 + 날짜 + 확장자)의 화이트보드 버전. 날짜 미정이면 "미정" 유지. */
export function buildWhiteboardFilename(title: string | undefined, date?: string): string {
  const base = title ? title.replace(/[/\\:*?"<>|]/g, '').replace(/\s+/g, '_').slice(0, 100) : 'meeting'
  const dateStr = normalizeDate(date)
  return `${base || 'meeting'}_${dateStr}.html`
}

/** 지시문 .txt 파일명: `<제목>_<날짜>_화이트보드_지시문.txt` (buildWhiteboardFilename 규칙 재사용, 날짜 미정이면 "미정"). */
export function buildInstructionFilename(title: string | undefined, date?: string): string {
  return buildWhiteboardFilename(title, date).replace(/\.html$/, '_화이트보드_지시문.txt')
}
