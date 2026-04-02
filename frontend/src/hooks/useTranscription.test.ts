import { renderHook } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useTranscription } from './useTranscription'
import { useTranscriptStore } from '../stores/transcriptStore'

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
        selectedLanguages: [],
      })),
    },
  ),
}))

vi.mock('../config', () => ({
  DIARIZATION: {},
  getWsUrl: () => 'ws://localhost/cable',
  getMode: () => 'local',
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
                  speaker_label: (raw.speaker ?? raw.speaker_label ?? 'SPEAKER_00') as string,
                  started_at_ms: (raw.started_at_ms ?? 0) as number,
                })
                break
              case 'final':
                store.addFinal({
                  id: (raw.id ?? raw.seq ?? 0) as number,
                  content: (raw.text ?? '') as string,
                  speaker_label: (raw.speaker ?? raw.speaker_label ?? 'SPEAKER_00') as string,
                  started_at_ms: (raw.started_at_ms ?? 0) as number,
                  ended_at_ms: (raw.ended_at_ms ?? 0) as number,
                  sequence_number: (raw.seq ?? 0) as number,
                  applied: false,
                })
                break
              case 'speaker_change':
                store.setSpeaker({
                  speaker_label: (raw.speaker ?? raw.speaker_label ?? 'SPEAKER_00') as string,
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
})
