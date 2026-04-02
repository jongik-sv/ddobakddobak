import type { Transcript } from '../api/meetings'
import type { TranscriptFinalData } from '../channels/transcription'

/**
 * API로 받은 Transcript[] 를 transcriptStore가 사용하는 TranscriptFinalData[] 로 변환한다.
 */
export function mapTranscriptsToFinals(transcripts: Transcript[]): TranscriptFinalData[] {
  return transcripts.map((t) => ({
    id: t.id,
    content: t.content,
    speaker_label: t.speaker_label,
    started_at_ms: t.started_at_ms,
    ended_at_ms: t.ended_at_ms,
    sequence_number: t.sequence_number,
    applied: t.applied_to_minutes ?? false,
  }))
}
