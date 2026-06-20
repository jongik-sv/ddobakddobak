/** 인라인 발화 근거 마커 ⟦t:<ms>[|/]s:<speaker>⟧ 파싱·직렬화 공용 유틸 (요약·챗 공유). */

export const CITATION_RE = /⟦t:(\d+(?::\d+)*)[|/]s:([^⟧]+)⟧/g

/** cross-meeting 인용 마커 ⟦m:<meetingId>/t:<ms>/s:<speaker>⟧ — 폴더/프로젝트 챗 전용. */
export const FOLDER_CITATION_RE = /⟦m:(\d+)\/t:(\d+(?::\d+)*)[|/]s:([^⟧]+)⟧/g

/** 마커 시각값 → ms. ':' 있으면 mm:ss 또는 hh:mm:ss, 없으면 이미 ms(숫자). */
export function markerTimeToMs(raw: string): number {
  if (!raw.includes(':')) return Number(raw)
  const parts = raw.split(':').map((p) => Number(p))
  if (parts.some((n) => Number.isNaN(n))) return 0
  const seconds = parts.reduce((acc, n) => acc * 60 + n, 0)
  return seconds * 1000
}

export interface CitationMarker {
  ms: number
  speaker: string
  index: number
  raw: string
}

export function parseCitationMarkers(text: string): CitationMarker[] {
  const out: CitationMarker[] = []
  let m: RegExpExecArray | null
  const re = new RegExp(CITATION_RE.source, 'g')
  let i = 0
  while ((m = re.exec(text)) !== null) {
    out.push({ ms: markerTimeToMs(m[1]), speaker: m[2], index: i++, raw: m[0] })
  }
  return out
}

export function stripCitationMarkers(text: string): string {
  return text.replace(new RegExp(CITATION_RE.source, 'g'), '').replace(/[ \t]+(?=\n|$)/g, '')
}

export function dedupeMarkers(markers: { ms: number; speaker: string }[]): { ms: number; speaker: string }[] {
  const seen = new Set<string>()
  const out: { ms: number; speaker: string }[] = []
  for (const m of markers) {
    const k = `${m.ms}|${m.speaker}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ ms: m.ms, speaker: m.speaker })
  }
  return out
}
