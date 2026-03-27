import { renderHook, act } from '@testing-library/react'
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

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe('useTranscription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useTranscriptStore.getState().reset()
    mockSubscriptions.create.mockReturnValue(mockSubscription)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('마운트 시 TranscriptionChannel 구독', () => {
    renderHook(() => useTranscription(1))
    expect(mockSubscriptions.create).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'TranscriptionChannel', meeting_id: 1 }),
      expect.any(Object)
    )
  })

  it('언마운트 시 구독 해제', () => {
    const { unmount } = renderHook(() => useTranscription(1))
    unmount()
    expect(mockSubscription.unsubscribe).toHaveBeenCalled()
  })

  it('sendChunk 호출 시 perform으로 오디오 전송', () => {
    const { result } = renderHook(() => useTranscription(1))
    const pcm = new Int16Array([100, 200, 300])
    act(() => { result.current.sendChunk(pcm) })
    expect(mockSubscription.perform).toHaveBeenCalledWith(
      'audio_chunk',
      expect.objectContaining({ data: expect.any(String) })
    )
  })

  it('partial 이벤트 수신 시 스토어 업데이트', () => {
    renderHook(() => useTranscription(1))
    const received = mockSubscriptions.create.mock.calls[0]![1].received!
    act(() => {
      received({
        type: 'partial',
        data: { content: '테스트', speaker_label: 'SPEAKER_00', started_at_ms: 0 },
      })
    })
    expect(useTranscriptStore.getState().partial?.content).toBe('테스트')
  })

  it('final 이벤트 수신 시 스토어 업데이트', () => {
    renderHook(() => useTranscription(1))
    const received = mockSubscriptions.create.mock.calls[0]![1].received!
    act(() => {
      received({
        type: 'final',
        data: {
          id: 1,
          content: '확정 발화',
          speaker_label: 'SPEAKER_00',
          started_at_ms: 0,
          ended_at_ms: 3000,
          sequence_number: 1,
        },
      })
    })
    expect(useTranscriptStore.getState().finals).toHaveLength(1)
    expect(useTranscriptStore.getState().finals[0].content).toBe('확정 발화')
  })

  it('speaker_change 이벤트 수신 시 currentSpeaker 업데이트', () => {
    renderHook(() => useTranscription(1))
    const received = mockSubscriptions.create.mock.calls[0]![1].received!
    act(() => {
      received({
        type: 'speaker_change',
        data: { speaker_label: 'SPEAKER_01', started_at_ms: 5000 },
      })
    })
    expect(useTranscriptStore.getState().currentSpeaker).toBe('SPEAKER_01')
  })

  it('meeting_notes_update 이벤트 수신 시 meetingNotes 업데이트', () => {
    renderHook(() => useTranscription(1))
    const received = mockSubscriptions.create.mock.calls[0]![1].received
    act(() => {
      received!({
        type: 'meeting_notes_update',
        notes_markdown: '# 회의록\n- 핵심 내용',
      })
    })
    expect(useTranscriptStore.getState().meetingNotes).toBe('# 회의록\n- 핵심 내용')
  })

  it('meetingId 변경 시 재구독', () => {
    const { rerender } = renderHook(({ id }: { id: number }) => useTranscription(id), {
      initialProps: { id: 1 },
    })
    rerender({ id: 2 })
    // 구독이 2번 생성되어야 함 (meetingId 변경)
    expect(mockSubscriptions.create).toHaveBeenCalledTimes(2)
  })
})
