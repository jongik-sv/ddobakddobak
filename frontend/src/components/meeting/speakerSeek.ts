import type { TranscriptFinalData } from '../../channels/transcription'

/** speaker의 발화들(asc 정렬 가정) 중 다음에 이동할 발화를 고른다. 없으면 null. */
export function pickSpeakerTarget(
  utts: TranscriptFinalData[],
  opts: { currentTimeMs: number; isPlaying: boolean; lastJumpMs: number },
): TranscriptFinalData | null {
  if (utts.length === 0) return null
  const cur = opts.currentTimeMs
  // 커서: 재생중 || 재생위치 존재 || 이미 한 번 점프함
  const hasCursor = opts.isPlaying || cur > 0 || opts.lastJumpMs >= 0
  if (!hasCursor) return utts[0] // 콜드스타트(started_at_ms===0 포함) → 첫 발화
  const base = Math.max(cur, opts.lastJumpMs)
  return utts.find((u) => u.started_at_ms > base) ?? utts[0] // 끝이면 wrap
}
