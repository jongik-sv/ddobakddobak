import type { Consumer, Subscription } from '@rails/actioncable'
import { useTranscriptStore } from '../stores/transcriptStore'

/**
 * TranscriptionChannel - ActionCable 실시간 STT 채널
 */

export type TranscriptPartialData = {
  content: string
  speaker_label: string
  started_at_ms: number
}

export type TranscriptFinalData = {
  id: number
  content: string
  speaker_label: string
  started_at_ms: number
  ended_at_ms: number
  sequence_number: number
  applied: boolean
  created_at?: string
  audio_source?: 'mic' | 'system'
}

export type SpeakerChangeData = {
  speaker_label: string
  started_at_ms: number
}

// Backend broadcasts a flat structure
type BackendMessage = {
  type: string
  text?: string
  speaker?: string
  speaker_label?: string
  started_at_ms?: number
  ended_at_ms?: number
  seq?: number
  id?: number
  created_at?: string
  notes_markdown?: string
  is_final?: boolean
  ids?: number[]
  audio_source?: 'mic' | 'system'
}

export function createTranscriptionChannel(
  meetingId: number,
  consumer: Consumer
): Subscription {
  return consumer.subscriptions.create(
    { channel: 'TranscriptionChannel', meeting_id: meetingId },
    {
      connected() {
        console.log('[ActionCable] 연결됨 — meeting:', meetingId)
      },
      disconnected() {
        console.warn('[ActionCable] 연결 끊김 — meeting:', meetingId)
      },
      rejected() {
        console.error('[ActionCable] 구독 거부됨 — meeting:', meetingId)
      },
      received(raw: BackendMessage) {
        const store = useTranscriptStore.getState()
        console.log('[ActionCable] 수신:', raw.type, raw)
        switch (raw.type) {
          case 'partial':
            store.setPartial({
              content: raw.text ?? '',
              speaker_label: raw.speaker ?? raw.speaker_label ?? 'SPEAKER_00',
              started_at_ms: raw.started_at_ms ?? 0,
            })
            break
          case 'final':
            store.addFinal({
              id: raw.id ?? raw.seq ?? 0,
              content: raw.text ?? '',
              speaker_label: raw.speaker ?? raw.speaker_label ?? 'SPEAKER_00',
              started_at_ms: raw.started_at_ms ?? 0,
              ended_at_ms: raw.ended_at_ms ?? 0,
              sequence_number: raw.seq ?? 0,
              applied: false,
              created_at: raw.created_at,
              audio_source: raw.audio_source,
            })
            break
          case 'speaker_change':
            store.setSpeaker({
              speaker_label: raw.speaker ?? raw.speaker_label ?? 'SPEAKER_00',
              started_at_ms: raw.started_at_ms ?? 0,
            })
            break
          case 'meeting_notes_update':
            store.setMeetingNotes(raw.notes_markdown ?? '')
            break
          case 'transcripts_applied':
            if (raw.ids && raw.ids.length > 0) {
              store.markApplied(raw.ids)
            }
            break
        }
      },
    }
  )
}

/**
 * Uint8Array를 Base64로 인코딩한다.
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 8192
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

/**
 * PCM Int16Array를 Base64로 인코딩하여 ActionCable로 전송
 */
export function sendAudioChunk(
  subscription: Subscription,
  pcm: Int16Array,
  meta?: { sequence: number; offsetMs: number },
  diarizationConfig?: Record<string, unknown>,
  languages?: string[],
  audioSource?: 'mic' | 'system',
): void {
  const bytes = new Uint8Array(pcm.buffer)
  const base64 = uint8ArrayToBase64(bytes)
  const payload: Record<string, unknown> = {
    data: base64,
    sequence: meta?.sequence ?? 0,
    offset_ms: meta?.offsetMs ?? 0,
  }
  if (diarizationConfig) {
    payload.diarization_config = diarizationConfig
  }
  if (languages && languages.length > 0) {
    payload.languages = languages
  }
  if (audioSource) {
    payload.audio_source = audioSource
  }
  subscription.perform('audio_chunk', payload)
}
