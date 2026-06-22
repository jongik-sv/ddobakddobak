import { renderHook } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useTranscription } from './useTranscription'
import { useTranscriptStore } from '../stores/transcriptStore'
import { useAppSettingsStore } from '../stores/appSettingsStore'
import { sendAudioChunk, sendHeartbeat } from '../channels/transcription'

// ──────────────────────────────────────────────
// ActionCable mock
// ──────────────────────────────────────────────

const mockSubscription = {
  perform: vi.fn(),
  unsubscribe: vi.fn(),
}

const mockSubscriptions = {
  create: vi.fn<(channel: unknown, callbacks: { connected?(): void; disconnected?(): void; rejected?(): void; received?(data: unknown): void }) => typeof mockSubscription>().mockReturnValue(mockSubscription),
}

const mockConsumer = {
  subscriptions: mockSubscriptions,
  disconnect: vi.fn(),
}

vi.mock('@rails/actioncable', () => ({
  createConsumer: vi.fn(() => mockConsumer),
}))

// Mock createTranscriptionChannel to delegate to our mock consumer
// and implement the message dispatching like the real channel does
const { mockCreateTranscriptionChannel } = vi.hoisted(() => ({
  mockCreateTranscriptionChannel: vi.fn(),
}))

vi.mock('../channels/transcription', () => ({
  createTranscriptionChannel: mockCreateTranscriptionChannel,
  sendAudioChunk: vi.fn(),
  sendHeartbeat: vi.fn(),
}))

// Mock appSettingsStore
vi.mock('../stores/appSettingsStore', () => ({
  useAppSettingsStore: Object.assign(
    vi.fn(() => ({})),
    {
      subscribe: vi.fn(() => () => {}),
      getState: vi.fn(() => ({
        diarizationEnabled: false,
        diarizationOverrides: {},
      })),
    },
  ),
}))

vi.mock('../config', () => ({
  DIARIZATION: {},
  getWsUrl: () => 'ws://localhost/cable',
  getMode: () => 'local',
  getServerKey: () => 'local',
}))

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe('useTranscription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useTranscriptStore.getState().reset()
    // Setup the createTranscriptionChannel mock to create a subscription via our mock consumer
    mockCreateTranscriptionChannel.mockImplementation((meetingId: number, consumer: typeof mockConsumer) => {
      return consumer.subscriptions.create(
        { channel: 'TranscriptionChannel', meeting_id: meetingId },
        {
          received(raw: Record<string, unknown>) {
            const store = useTranscriptStore.getState()
            switch (raw.type) {
              case 'partial':
                store.setPartial({
                  content: (raw.text ?? '') as string,
                  speaker_label: (raw.speaker ?? raw.speaker_label ?? '화자 1') as string,
                  started_at_ms: (raw.started_at_ms ?? 0) as number,
                })
                break
              case 'final':
                store.addFinal({
                  id: (raw.id ?? raw.seq ?? 0) as number,
                  content: (raw.text ?? '') as string,
                  speaker_label: (raw.speaker ?? raw.speaker_label ?? '화자 1') as string,
                  started_at_ms: (raw.started_at_ms ?? 0) as number,
                  ended_at_ms: (raw.ended_at_ms ?? 0) as number,
                  sequence_number: (raw.seq ?? 0) as number,
                  applied: false,
                })
                break
              case 'speaker_change':
                store.setSpeaker({
                  speaker_label: (raw.speaker ?? raw.speaker_label ?? '화자 1') as string,
                  started_at_ms: (raw.started_at_ms ?? 0) as number,
                })
                break
              case 'meeting_notes_update':
                store.setMeetingNotes((raw.notes_markdown ?? '') as string)
                break
            }
          },
        }
      )
    })
    mockSubscriptions.create.mockReturnValue(mockSubscription)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('마운트 시 TranscriptionChannel 구독', () => {
    renderHook(() => useTranscription(1))
    expect(mockCreateTranscriptionChannel).toHaveBeenCalledWith(1, expect.any(Object))
  })

  it('언마운트 시 구독 해제', () => {
    const { unmount } = renderHook(() => useTranscription(1))
    unmount()
    expect(mockSubscription.unsubscribe).toHaveBeenCalled()
  })

  it('sendChunk이 함수이다', () => {
    const { result } = renderHook(() => useTranscription(1))
    expect(typeof result.current.sendChunk).toBe('function')
  })

  it('meetingId 변경 시 재구독', () => {
    const { rerender } = renderHook(({ id }: { id: number }) => useTranscription(id), {
      initialProps: { id: 1 },
    })
    rerender({ id: 2 })
    // 구독이 2번 생성되어야 함 (meetingId 변경)
    expect(mockCreateTranscriptionChannel).toHaveBeenCalledTimes(2)
  })

  it('마운트만으로는 하트비트를 보내지 않는다 (시청자/2번째 탭 keep-alive 회귀 차단)', () => {
    // 하트비트는 useLiveRecording의 활성 녹음 게이트에서만 발사돼야 한다.
    // useTranscription 단독 마운트(시청자 MeetingViewerPage)는 0회여야 한다 —
    // 안 그러면 다른 탭/기기가 owner 롤로 heartbeat를 보내 stale-recording 자동종결이 무력화된다.
    renderHook(() => useTranscription(1))
    expect(vi.mocked(sendHeartbeat)).not.toHaveBeenCalled()
  })

  it('sendHeartbeat() 호출 시 채널 하트비트를 전송한다', () => {
    const { result } = renderHook(() => useTranscription(1))
    expect(typeof result.current.sendHeartbeat).toBe('function')
    expect(vi.mocked(sendHeartbeat)).not.toHaveBeenCalled()
    result.current.sendHeartbeat()
    expect(vi.mocked(sendHeartbeat)).toHaveBeenCalledWith(mockSubscription)
  })

  it('실시간 청크의 diarization enable은 토글이 ON이어도 항상 false', () => {
    // 화자 분리 토글은 배치(파일 업로드/STT 재생성) 경로 전용 —
    // 실시간 /transcribe 청크에는 enable: false가 강제된다.
    vi.mocked(useAppSettingsStore.getState).mockReturnValueOnce({
      diarizationEnabled: true,
      diarizationOverrides: {},
    } as ReturnType<typeof useAppSettingsStore.getState>)

    const { result } = renderHook(() => useTranscription(1))
    result.current.sendChunk(new Int16Array([1, 2, 3]))

    expect(sendAudioChunk).toHaveBeenCalledWith(
      mockSubscription,
      expect.any(Int16Array),
      undefined,
      expect.objectContaining({ enable: false }),
      'mic',
    )
  })
})
