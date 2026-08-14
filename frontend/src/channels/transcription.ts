import type { Consumer, Subscription } from '@rails/actioncable'
import { uint8ArrayToBase64 } from '../lib/audioUtils'
import { useTranscriptStore } from '../stores/transcriptStore'
import { useRecordingSignalsStore } from '../stores/recordingSignalsStore'
import { useToastStore } from '../stores/toastStore'
import type { Transcript } from '../api/meetings/types'

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
  // transcript_redacted: 파기된 전사 행 id 와 잘라낸 오디오 구간.
  deleted_ids?: number[]
  ranges?: { start_ms: number; end_ms: number }[]
  total_cut_ms?: number
  audio_duration_ms?: number
  summaries_destroyed?: boolean
  // notes update extras
  source?: string
  client_id?: string
  // transcript_split: 원행(조각1, 갱신)과 신규행(조각2, 삽입) — transcript_json 그대로.
  updated?: Transcript
  inserted?: Transcript
  // transcript_speaker_updated: 화자변경(분할 없음) 대상 행 id + 새 화자.
  // speaker_label은 위에 이미 선언됨(partial/final과 공유).
  speaker_name?: string | null
  // summarization progress
  summary_type?: 'realtime' | 'final'
  ok?: boolean
  error?: string
  // recording signals
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
          case 'transcript_split': {
            // Echo 가드: 내 분할 요청 응답으로 이미 store가 갱신됨 (SplitTranscriptDialog가 직접 반영)
            if (raw.client_id && raw.client_id === store.clientId) {
              break
            }
            // Reset 가드: 최근 reset 직후의 잔여 broadcast 무시
            if (Date.now() - store.lastResetAt < 5000) {
              break
            }
            if (raw.updated && raw.inserted) {
              store.applySplit(raw.updated, raw.inserted)
              // TranscriptPanel은 prop(transcripts) 구조 기반이라 store.applySplit만으론 삽입된
              // 행이 화면에 안 나타난다 — MeetingPage가 자신의 배열을 재조회하도록 신호를 올린다.
              // 로컬 split(SplitTranscriptDialog가 이 채널을 거치지 않고 store.applySplit을 직접
              // 호출하는 경로)은 여기를 타지 않으므로 카운터가 증가하지 않는다.
              store.markRemoteStructureChange()
            }
            break
          }
          case 'transcript_speaker_updated': {
            // Echo 가드: 내 화자변경 요청 응답으로 이미 store가 갱신됨 (SplitTranscriptDialog가 직접 반영)
            if (raw.client_id && raw.client_id === store.clientId) {
              break
            }
            // Reset 가드: 최근 reset 직후의 잔여 broadcast 무시
            if (Date.now() - store.lastResetAt < 5000) {
              break
            }
            if (typeof raw.id === 'number' && typeof raw.speaker_label === 'string') {
              store.applySpeakerChange(raw.id, raw.speaker_label, raw.speaker_name ?? null)
              // TranscriptPanel의 그룹 경계·테두리 색은 prop(transcripts)의 speaker_label을 직접
              // 읽는다(split과 동일한 이유) — store만 갱신해선 원격에서 바뀐 화자가 화면에 반영되지
              // 않으므로 페이지가 재조회하도록 신호를 올린다.
              store.markRemoteStructureChange()
            }
            break
          }
          case 'transcript_redacted': {
            // Echo 가드: 내 절단 요청은 응답 경로(MeetingPage.handleTranscriptRedact)가 이미
            // store·배열·audioRevision을 전부 갱신했다. 여기서 또 올리면 오디오 blob을 두 번
            // 받는다 — 오디오 재로드는 어느 경로로든 정확히 1회여야 한다.
            if (raw.client_id && raw.client_id === store.clientId) {
              break
            }
            // Reset 가드: 최근 reset 직후의 잔여 broadcast 무시
            if (Date.now() - store.lastResetAt < 5000) {
              break
            }
            if (raw.deleted_ids && raw.deleted_ids.length > 0) {
              store.removeFinals(raw.deleted_ids)
            }
            // TranscriptPanel은 prop(transcripts) 구조 기반이라 store만 갱신해선 삭제·시프트가
            // 화면에 반영되지 않는다 — 페이지가 전체 재조회하도록 신호를 올린다.
            store.markRemoteStructureChange()
            // 오디오 파일이 같은 URL에서 교체됐다 — 캐시된 옛 blob을 계속 쓰면 절단한 기밀이
            // 계속 들린다.
            store.markAudioChanged()
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
          case 'recording_stopped':
            useRecordingSignalsStore.getState().setRecordingStopped(true)
            break
          case 'recording_paused':
            // meeting_id를 담아 회의별로 스코프 — 타 회의 뷰어로 신호가 누수되지 않게.
            useRecordingSignalsStore.getState().setRecordingPaused(raw.meeting_id ?? meetingId, true)
            break
          case 'recording_resumed':
            useRecordingSignalsStore.getState().setRecordingPaused(raw.meeting_id ?? meetingId, false)
            break
          case 'recording_denied':
          case 'recording_in_progress':
            // 다른 세션이 이미 녹음 중 — 이 세션은 녹음 불가(읽기전용 뷰어로 라우팅)
            useRecordingSignalsStore.getState().setRecordingDenied(true)
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
