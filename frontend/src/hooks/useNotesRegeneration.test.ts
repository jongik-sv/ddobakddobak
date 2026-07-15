import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useNotesRegeneration } from './useNotesRegeneration'
import { useTranscriptStore } from '../stores/transcriptStore'

// 완료 감지 구독의 received 핸들러 캡처용 (vi.mock 팩토리보다 먼저 초기화돼야 하므로 hoisted)
const holder = vi.hoisted(() => ({
  received: null as null | ((data: Record<string, unknown>) => void),
}))

vi.mock('../api/meetings', () => ({
  regenerateStt: vi.fn(async () => {}),
  reDiarize: vi.fn(async () => {}),
  regenerateNotes: vi.fn(async () => {}),
}))

vi.mock('../lib/actionCableAuth', () => ({
  createAuthenticatedConsumer: () => ({
    subscriptions: {
      create: (_params: unknown, handlers: { received: (d: Record<string, unknown>) => void }) => {
        holder.received = handlers.received.bind(handlers)
        return { unsubscribe() {} }
      },
    },
    disconnect() {},
  }),
}))

describe('useNotesRegeneration — final 요약 실패 시 재생성 스피너 고착 해제', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    holder.received = null
    useTranscriptStore.setState({ summaryError: null, meetingNotes: null })
  })

  // 재생성 시작 → isRegeneratingNotes:true + 완료 감지 구독(received 캡처)까지 진행
  async function startRegeneration() {
    const options = { pauseAudio: vi.fn(), refetch: vi.fn() }
    const rendered = renderHook(() => useNotesRegeneration(1, options))
    await act(async () => {
      await rendered.result.current.handleRegenerateNotes()
    })
    expect(rendered.result.current.isRegeneratingNotes).toBe(true)
    expect(holder.received).not.toBeNull()
    return { ...rendered, options }
  }

  it('summarization_finished ok:false + final → isRegeneratingNotes 해제', async () => {
    const { result } = await startRegeneration()

    act(() => holder.received!({ type: 'summarization_finished', ok: false, summary_type: 'final' }))

    expect(result.current.isRegeneratingNotes).toBe(false)
  })

  it('ok:false final → summaryError 세팅(배지 레포트) + refetch로 서버 정본 동기화', async () => {
    // 회의 상세 페이지에는 전역 토스트가 렌더되지 않으므로 훅이 직접 배지 상태를 세팅해야 한다
    const { options } = await startRegeneration()

    act(() =>
      holder.received!({
        type: 'summarization_finished',
        ok: false,
        summary_type: 'final',
        error: 'LLM 응답 오류',
      })
    )

    expect(useTranscriptStore.getState().summaryError).toEqual({
      kind: 'final',
      message: 'LLM 응답 오류',
    })
    expect(options.refetch).toHaveBeenCalled()
  })

  it('ok:false final에 error가 없으면 "알 수 없는 오류"로 레포트한다', async () => {
    await startRegeneration()

    act(() => holder.received!({ type: 'summarization_finished', ok: false, summary_type: 'final' }))

    expect(useTranscriptStore.getState().summaryError).toEqual({
      kind: 'final',
      message: '알 수 없는 오류',
    })
  })

  it('실패 후 재시도 성공(meeting_notes_update) 시 summaryError 배지를 클리어한다', async () => {
    const { result } = await startRegeneration()
    act(() => holder.received!({ type: 'summarization_finished', ok: false, summary_type: 'final' }))
    expect(useTranscriptStore.getState().summaryError).not.toBeNull()

    // 재시도: 다시 재생성 시작(새 구독) → 성공 broadcast 수신
    await act(async () => {
      await result.current.handleRegenerateNotes()
    })
    act(() => holder.received!({ type: 'meeting_notes_update', notes_markdown: '# 재시도 성공' }))

    expect(useTranscriptStore.getState().summaryError).toBeNull()
  })

  it('realtime 실패는 재생성 스피너에 영향 없음', async () => {
    const { result } = await startRegeneration()

    act(() => holder.received!({ type: 'summarization_finished', ok: false, summary_type: 'realtime' }))

    expect(result.current.isRegeneratingNotes).toBe(true)
  })

  it('ok:true final finished는 스피너 유지 (해제는 meeting_notes_update가 담당)', async () => {
    const { result } = await startRegeneration()

    act(() => holder.received!({ type: 'summarization_finished', ok: true, summary_type: 'final' }))

    expect(result.current.isRegeneratingNotes).toBe(true)
  })

  it('meeting_notes_update → 스피너 해제 + refetch (기존 동작 회귀)', async () => {
    const { result, options } = await startRegeneration()

    act(() => holder.received!({ type: 'meeting_notes_update', notes_markdown: '# 새 회의록' }))

    expect(result.current.isRegeneratingNotes).toBe(false)
    expect(options.refetch).toHaveBeenCalled()
  })
})
