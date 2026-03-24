import type { TranscriptFinalData } from '../channels/transcription'

export type TranscriptBlockInsert = {
  type: 'transcript'
  props: { speakerLabel: string; text: string }
}

export function finalToBlock(data: TranscriptFinalData): TranscriptBlockInsert {
  return {
    type: 'transcript',
    props: { speakerLabel: data.speaker_label, text: data.content },
  }
}

export function transcriptsToBlocks(finals: TranscriptFinalData[]): TranscriptBlockInsert[] {
  return finals.map(finalToBlock)
}
