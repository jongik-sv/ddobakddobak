import type { Transcript } from '../api/meetings'
import type { TranscriptFinalData } from '../channels/transcription'

/**
 * API로 받은 Transcript[] 를 transcriptStore가 사용하는 TranscriptFinalData[] 로 변환한다.
 *
 * @param appliedDefault `applied_to_minutes`가 null일 때의 기본값. 실시간 경로는 false,
 *   회의록 리로드(오타수정/상태변경) 경로는 true.
 */
export function mapTranscriptsToFinals(
  transcripts: Transcript[],
  appliedDefault = false,
): TranscriptFinalData[] {
  return transcripts.map((t) => ({
    id: t.id,
    content: t.content,
    speaker_label: t.speaker_label,
    speaker_name: t.speaker_name ?? null,
    started_at_ms: t.started_at_ms,
    ended_at_ms: t.ended_at_ms,
    sequence_number: t.sequence_number,
    applied: t.applied_to_minutes ?? appliedDefault,
  }))
}
