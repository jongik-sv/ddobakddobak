import type { Consumer, Subscription } from '@rails/actioncable'
import { uint8ArrayToBase64 } from '../lib/audioUtils'
import { useTranscriptStore } from '../stores/transcriptStore'
import { useSharingStore } from '../stores/sharingStore'

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
  // sharing events
  participant_id?: number
  user_id?: number
  user_name?: string
  role?: string
  joined_at?: string
  new_host_id?: number
  new_host_name?: string
  meeting_id?: number
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
        const speakerLabel = raw.speaker ?? raw.speaker_label ?? 'SPEAKER_00'

        switch (raw.type) {
          case 'partial':
            store.setPartial({
              content: raw.text ?? '',
              speaker_label: speakerLabel,
              started_at_ms: raw.started_at_ms ?? 0,
            })
            break
          case 'final':
            store.addFinal({
              id: raw.id ?? raw.seq ?? 0,
              content: raw.text ?? '',
              speaker_label: speakerLabel,
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
              speaker_label: speakerLabel,
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
          case 'participant_joined':
            useSharingStore.getState().addParticipant({
              id: raw.participant_id ?? 0,
              user_id: raw.user_id ?? 0,
              user_name: raw.user_name ?? '',
              role: (raw.role as 'host' | 'viewer') ?? 'viewer',
              joined_at: raw.joined_at ?? '',
            })
            break
          case 'participant_left':
            useSharingStore.getState().removeParticipant(raw.user_id ?? 0)
            break
          case 'host_transferred':
            useSharingStore.getState().transferHost(raw.new_host_id ?? 0)
            break
          case 'recording_stopped':
            useSharingStore.getState().setRecordingStopped(true)
            break
          case 'sharing_stopped':
            useSharingStore.getState().stopSharing()
            break
        }
      },
    }
  )
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
