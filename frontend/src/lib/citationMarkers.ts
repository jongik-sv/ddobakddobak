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

/** speakerAtMs가 받는 final의 최소 형태. transcriptStore의 TranscriptFinalData와 호환된다. */
export interface SpeakerLookupFinal {
  started_at_ms: number
  ended_at_ms: number | null
  speaker_label: string
  speaker_name?: string | null
}

/**
 * ms 시점에 현재(화자분리 후) 발화 화자를 finals에서 찾는다.
 * - ms를 포함하는 구간이 여럿이면(오디오 overlap 500ms로 구간이 겹침) started_at_ms가 가장 큰
 *   (=가장 늦게 시작한) 구간을 고른다. 마커 ms는 정확히 어떤 전사의 started_at_ms이고,
 *   재분리는 speaker만 rewrite하므로(started/ended·분절 보존) 그 마커가 가리킨 발화는
 *   ms === started_at_ms인 구간이다.
 *   (ended_at_ms가 null이면 정확히 started_at_ms와 일치할 때만 포함으로 본다.)
 * - 포함 구간이 하나도 없으면 started_at_ms가 ms에 가장 가까운 final 반환(절대 차이 최소).
 * - finals가 비어있으면 null.
 * 요약 생성 시점에 박힌 옛 화자 대신, 배지 시각으로 최신 화자를 해석하기 위함.
 */
export function speakerAtMs(
  finals: SpeakerLookupFinal[],
  ms: number,
): { speaker_label: string; speaker_name: string | null } | null {
  if (finals.length === 0) return null
  let containing: SpeakerLookupFinal | null = null
  for (const f of finals) {
    const inRange =
      ms >= f.started_at_ms &&
      (f.ended_at_ms == null ? ms === f.started_at_ms : ms <= f.ended_at_ms)
    // 포함 구간 중 started_at_ms가 MAX인 것 선택(겹침 해소, 배열순서 무관). 동률이면 먼저 본 것 유지.
    if (inRange && (containing == null || f.started_at_ms > containing.started_at_ms)) {
      containing = f
    }
  }
  if (containing != null) {
    return { speaker_label: containing.speaker_label, speaker_name: containing.speaker_name ?? null }
  }
  let nearest = finals[0]
  let bestDiff = Math.abs(finals[0].started_at_ms - ms)
  for (const f of finals) {
    const diff = Math.abs(f.started_at_ms - ms)
    if (diff < bestDiff) {
      bestDiff = diff
      nearest = f
    }
  }
  return { speaker_label: nearest.speaker_label, speaker_name: nearest.speaker_name ?? null }
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
