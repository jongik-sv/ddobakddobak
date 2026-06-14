/** 북마크 기본 라벨 계산 — 시점을 덮는(또는 가장 가까운) transcript 내용을 잘라 반환 */

export interface BookmarkTranscript {
  content: string
  started_at_ms: number
  ended_at_ms: number
}

const MAX_LABEL_LEN = 40

/**
 * 주어진 시점(ts, ms)에 해당하는 transcript 내용을 기본 북마크 라벨로 만든다.
 * - 덮는 transcript: started_at_ms <= ts < ended_at_ms
 * - 없으면(공백/무음): 시간상 가장 가까운 transcript (앞/뒤 무관, 동률이면 앞)
 * - transcript가 없으면 빈 문자열
 * 내용은 trim 후 40자 초과 시 …로 자른다. 화자는 포함하지 않는다.
 */
export function computeBookmarkLabel(transcripts: BookmarkTranscript[], ts: number): string {
  if (!transcripts || transcripts.length === 0) return ''

  let target: BookmarkTranscript | undefined = transcripts.find(
    (t) => ts >= t.started_at_ms && ts < t.ended_at_ms,
  )

  if (!target) {
    let bestDist = Infinity
    for (const t of transcripts) {
      const dist = ts < t.started_at_ms ? t.started_at_ms - ts : ts - t.ended_at_ms
      if (dist < bestDist) {
        bestDist = dist
        target = t
      }
    }
  }

  if (!target) return ''

  const s = target.content.trim()
  return s.length > MAX_LABEL_LEN ? s.slice(0, MAX_LABEL_LEN) + '…' : s
}
