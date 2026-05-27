import { describe, it, expect, beforeEach } from 'vitest'
import { useTranscriptStore } from '../stores/transcriptStore'
import { createTranscriptionChannel } from './transcription'
import { useSharingStore } from '../stores/sharingStore'

type ReceivedFn = (raw: Record<string, unknown>) => void

// 실제 createTranscriptionChannel의 received 핸들러를 가짜 consumer로 캡처한다.
function captureReceived(): ReceivedFn {
  let received: ReceivedFn | undefined
  const consumer = {
    subscriptions: {
      create: (_params: unknown, handlers: { received: ReceivedFn }) => {
        received = handlers.received.bind(handlers)
        return { unsubscribe() {}, perform() {} }
      },
    },
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createTranscriptionChannel(1, consumer as any)
  if (!received) throw new Error('received handler not captured')
  return received
}

describe('received 라우팅: recording_denied', () => {
  beforeEach(() => {
    useSharingStore.getState().reset()
  })

  it('recording_denied 메시지가 sharingStore.recordingDenied를 true로 설정한다', () => {
    const received = captureReceived()
    received({ type: 'recording_denied', meeting_id: 1 })
    expect(useSharingStore.getState().recordingDenied).toBe(true)
  })

  it('recording_in_progress 메시지도 recordingDenied를 true로 설정한다(뷰어 라우팅 트리거)', () => {
    const received = captureReceived()
    received({ type: 'recording_in_progress', meeting_id: 1 })
    expect(useSharingStore.getState().recordingDenied).toBe(true)
  })
})

describe('transcript_updated 처리 로직', () => {
  beforeEach(() => {
    useTranscriptStore.setState({
      partial: null,
      finals: [
        { id: 7, content: '원본', speaker_label: 'A', started_at_ms: 0, ended_at_ms: 1000, sequence_number: 1, applied: false },
      ],
      appliedIds: new Set(),
      meetingNotes: null,
      currentSpeaker: null,
      isSummarizing: false,
      summarizationKind: null,
      lastUserEditAt: 0,
      lastResetAt: 0,
    })
  })

  it('타 client의 메시지는 store에 반영', () => {
    const store = useTranscriptStore.getState()
    const raw = { type: 'transcript_updated', id: 7, content: '바뀜', client_id: 'other-client' }

    if (!(raw.client_id && raw.client_id === store.clientId) &&
        Date.now() - store.lastResetAt >= 5000 &&
        typeof raw.id === 'number' && typeof raw.content === 'string') {
      store.updateFinal(raw.id, raw.content)
    }

    expect(useTranscriptStore.getState().finals[0].content).toBe('바뀜')
  })

  it('내 client_id면 drop (echo)', () => {
    const myClientId = useTranscriptStore.getState().clientId
    const store = useTranscriptStore.getState()
    const raw = { type: 'transcript_updated', id: 7, content: '에코', client_id: myClientId }

    if (raw.client_id && raw.client_id === store.clientId) {
      // drop
    } else if (typeof raw.id === 'number' && typeof raw.content === 'string') {
      store.updateFinal(raw.id, raw.content)
    }

    expect(useTranscriptStore.getState().finals[0].content).toBe('원본')
  })

  it('reset 가드: lastResetAt 직후는 drop', () => {
    useTranscriptStore.setState({ lastResetAt: Date.now() })
    const store = useTranscriptStore.getState()
    const raw = { type: 'transcript_updated', id: 7, content: '리셋후', client_id: 'other' }

    if (raw.client_id && raw.client_id === store.clientId) return
    if (Date.now() - store.lastResetAt < 5000) {
      // drop
    } else if (typeof raw.id === 'number' && typeof raw.content === 'string') {
      store.updateFinal(raw.id, raw.content)
    }

    expect(useTranscriptStore.getState().finals[0].content).toBe('원본')
  })
})
