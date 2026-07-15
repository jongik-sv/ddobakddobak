import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useTranscriptStore } from '../stores/transcriptStore'
import { createTranscriptionChannel } from './transcription'
import { useSharingStore } from '../stores/sharingStore'
import { useToastStore } from '../stores/toastStore'

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

describe('received 라우팅: summarization_finished 실패 레포트', () => {
  // showStatus 시그니처를 명시해 setState 파라미터 타입과 호환되게 한다 (tsc 오류 방지)
  let showStatusMock: ReturnType<typeof vi.fn<(message: string, durationMs?: number) => void>>

  beforeEach(() => {
    useTranscriptStore.getState().reset()
    // reset()은 lastResetAt을 보존하므로 meeting_notes_update의 reset 가드에 걸리지 않게 명시 초기화
    useTranscriptStore.setState({ lastResetAt: 0 })
    showStatusMock = vi.fn<(message: string, durationMs?: number) => void>()
    useToastStore.setState({ showStatus: showStatusMock })
  })

  it('ok:false → 스피너 해제 + summaryError 세팅 + 토스트 표시', () => {
    const received = captureReceived()
    received({ type: 'summarization_started', summary_type: 'realtime' })
    expect(useTranscriptStore.getState().isSummarizing).toBe(true)

    received({ type: 'summarization_finished', summary_type: 'realtime', ok: false, error: 'LLM 오류' })

    const state = useTranscriptStore.getState()
    expect(state.isSummarizing).toBe(false)
    expect(state.summaryError).toEqual({ kind: 'realtime', message: 'LLM 오류' })
    expect(showStatusMock).toHaveBeenCalledTimes(1)
    expect(showStatusMock).toHaveBeenCalledWith(expect.stringContaining('요약 생성 실패'), expect.any(Number))
  })

  it('실패 스트릭 중 반복 ok:false는 토스트를 다시 띄우지 않는다 (매분 cron 스팸 방지)', () => {
    const received = captureReceived()
    received({ type: 'summarization_finished', summary_type: 'realtime', ok: false, error: '오류1' })
    received({ type: 'summarization_finished', summary_type: 'realtime', ok: false, error: '오류2' })

    expect(showStatusMock).toHaveBeenCalledTimes(1)
    // 배지 상태는 최신 실패 사유로 갱신된다
    expect(useTranscriptStore.getState().summaryError?.message).toBe('오류2')
  })

  it('성공(ok:true) finished는 summaryError를 클리어하고 다음 실패에 다시 토스트한다', () => {
    const received = captureReceived()
    received({ type: 'summarization_finished', summary_type: 'realtime', ok: false, error: '오류' })
    received({ type: 'summarization_finished', summary_type: 'realtime', ok: true })

    expect(useTranscriptStore.getState().summaryError).toBeNull()

    // 성공으로 스트릭이 끝났으므로 새 실패는 다시 토스트 1회
    received({ type: 'summarization_finished', summary_type: 'realtime', ok: false, error: '새 오류' })
    expect(showStatusMock).toHaveBeenCalledTimes(2)
  })

  it('ok 미지정(레거시 broadcast)은 실패로 취급하지 않는다', () => {
    const received = captureReceived()
    received({ type: 'summarization_finished', summary_type: 'realtime' })

    expect(useTranscriptStore.getState().summaryError).toBeNull()
    expect(showStatusMock).not.toHaveBeenCalled()
  })

  it('error 없는 ok:false는 "알 수 없는 오류"로 표시한다', () => {
    const received = captureReceived()
    received({ type: 'summarization_finished', summary_type: 'final', ok: false })

    expect(useTranscriptStore.getState().summaryError).toEqual({ kind: 'final', message: '알 수 없는 오류' })
  })

  it('reset 직후(5초 이내) 도착한 stale ok:false는 배지·토스트 없이 무시한다', () => {
    const received = captureReceived()
    useTranscriptStore.setState({ lastResetAt: Date.now() })

    received({ type: 'summarization_finished', summary_type: 'realtime', ok: false, error: '옛 회의 오류' })

    expect(useTranscriptStore.getState().summaryError).toBeNull()
    expect(showStatusMock).not.toHaveBeenCalled()
  })

  it('reset 가드 중에도 스피너 해제는 수행된다 (setSummarizing null)', () => {
    const received = captureReceived()
    received({ type: 'summarization_started', summary_type: 'realtime' })
    useTranscriptStore.setState({ lastResetAt: Date.now() })

    received({ type: 'summarization_finished', summary_type: 'realtime', ok: false, error: '오류' })

    expect(useTranscriptStore.getState().isSummarizing).toBe(false)
    expect(useTranscriptStore.getState().summaryError).toBeNull()
  })

  it('meeting_notes_update 수신(요약 성공)이 summaryError를 클리어한다', () => {
    const received = captureReceived()
    received({ type: 'summarization_finished', summary_type: 'realtime', ok: false, error: '오류' })
    expect(useTranscriptStore.getState().summaryError).not.toBeNull()

    received({ type: 'meeting_notes_update', notes_markdown: '# 새 회의록' })
    expect(useTranscriptStore.getState().summaryError).toBeNull()
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
