import { describe, it, expect, beforeEach } from 'vitest'
import { useTranscriptStore } from '../stores/transcriptStore'

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
