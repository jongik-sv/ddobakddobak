import type { Consumer, Subscription } from '@rails/actioncable'
import { uint8ArrayToBase64 } from '../lib/audioUtils'
import { useTranscriptStore } from '../stores/transcriptStore'
import { useSharingStore } from '../stores/sharingStore'
import { useToastStore } from '../stores/toastStore'

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
  speaker_name?: string | null
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
  content?: string
  is_final?: boolean
  ids?: number[]
  audio_source?: 'mic' | 'system'
  // notes update extras
  source?: string
  client_id?: string
  // summarization progress
  summary_type?: 'realtime' | 'final'
  ok?: boolean
  error?: string
  // sharing events
  participant_id?: number
  user_id?: number
  user_name?: string
  role?: string
  joined_at?: string
  new_host_id?: number
  new_host_name?: string
  meeting_id?: number
  grace_period_seconds?: number
  disconnected_host_id?: number
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
        const speakerLabel = raw.speaker ?? raw.speaker_label ?? '화자 1'

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
          case 'meeting_notes_update': {
            // Echo 가드: 내 PATCH가 만든 broadcast면 무시 (이미 로컬 반영됨)
            if (raw.source === 'user' && raw.client_id && raw.client_id === store.clientId) {
              break
            }
            // Reset 가드: 최근 reset 직후의 잔여 broadcast는 무시
            if (Date.now() - store.lastResetAt < 5000) {
              break
            }
            store.setMeetingNotes(raw.notes_markdown ?? '')
            // 회의록이 실제로 갱신됨 = 요약 성공 — 이전 실패 상태 클리어
            if (store.summaryError) store.setSummaryError(null)
            break
          }
          case 'transcripts_applied':
            if (raw.ids && raw.ids.length > 0) {
              store.markApplied(raw.ids)
            }
            break
          case 'transcript_updated': {
            // Echo 가드: 내 PATCH 응답으로 이미 store가 갱신됨
            if (raw.client_id && raw.client_id === store.clientId) {
              break
            }
            // Reset 가드: 최근 reset 직후의 잔여 broadcast 무시
            if (Date.now() - store.lastResetAt < 5000) {
              break
            }
            if (typeof raw.id === 'number' && typeof raw.content === 'string') {
              store.updateFinal(raw.id, raw.content)
            }
            break
          }
          case 'meeting_reset':
            store.markReset()
            store.reset()
            break
          case 'summarization_started':
            store.setSummarizing(raw.summary_type ?? 'realtime')
            break
          case 'summarization_finished':
            // 성패와 무관하게 스피너는 항상 해제 (실패 시 스피너 고착 방지)
            store.setSummarizing(null)
            if (raw.ok === false) {
              // Reset 가드: 리셋 직후 도착한 stale 실패 broadcast가 빈 회의에
              // 배지·토스트를 띄우지 않도록 무시 (다른 케이스와 동일 패턴)
              if (Date.now() - store.lastResetAt < 5000) {
                break
              }
              const message = raw.error || '알 수 없는 오류'
              // 실패 스트릭당 토스트 1회만 — realtime cron이 1분마다 재시도하므로 매번 띄우면 스팸
              if (store.summaryError === null) {
                useToastStore.getState().showStatus(`요약 생성 실패: ${message}`, 5000)
              }
              store.setSummaryError({ kind: raw.summary_type ?? 'realtime', message })
            } else if (store.summaryError) {
              // 성공(ok !== false) — 실패 스트릭 종료, 상태 클리어
              store.setSummaryError(null)
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
          case 'recording_denied':
          case 'recording_in_progress':
            // 다른 세션이 이미 녹음 중 — 이 세션은 녹음 불가(읽기전용 뷰어로 라우팅)
            useSharingStore.getState().setRecordingDenied(true)
            break
          case 'host_disconnected':
            useSharingStore.getState().setHostDisconnected(
              raw.user_id ?? 0,
              raw.grace_period_seconds ?? 10,
            )
            break
          case 'host_reconnected':
            useSharingStore.getState().clearHostDisconnected()
            break
          case 'host_claimable':
            useSharingStore.getState().setHostClaimable(true)
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
// 회의 언어(mode/languages)는 서버가 회의 생성자 설정에서 결정하므로 전송하지 않는다.
export function sendAudioChunk(
  subscription: Subscription,
  pcm: Int16Array,
  meta?: { sequence: number; offsetMs: number },
  diarizationConfig?: Record<string, unknown>,
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
  if (audioSource) {
    payload.audio_source = audioSource
  }
  subscription.perform('audio_chunk', payload)
}

/**
 * 녹음 클라 생존 신호(하트비트)를 채널로 전송한다.
 * 서버는 owner/host + recording 일 때만 recorder_heartbeat_at 을 갱신(throttle).
 * 크래시/강제종료로 하트비트가 끊기면 서버가 stale recording 으로 자동 종결한다.
 */
export function sendHeartbeat(subscription: Subscription): void {
  subscription.perform('heartbeat', {})
}
