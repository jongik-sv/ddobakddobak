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

const getAiOriginalMock = vi.hoisted(() => vi.fn())
vi.mock('../api/sttTermLearning', () => ({ getAiOriginal: getAiOriginalMock }))

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

describe('useNotesRegeneration — 재생성 확인창 안내(사람 편집 여부)', () => {
  const options = { pauseAudio: vi.fn(), refetch: vi.fn() }
  beforeEach(() => { getAiOriginalMock.mockReset() })

  it('사람이 고친 회의록이면 용어 유지 안내 문구로 확인창을 연다', async () => {
    getAiOriginalMock.mockResolvedValue({ available: true, human_edited_at: '2026-11-24T00:00:00Z', diff: [], stt_learning_enabled: true })
    const { result } = renderHook(() => useNotesRegeneration(1, options))
    await act(async () => { await result.current.requestNotesConfirm() })
    expect(result.current.showNotesConfirm).toBe(true)
    expect(result.current.notesConfirmMessage).toBe(
      '직접 고친 문장은 새로 작성됩니다. 학습된 용어는 새 회의록에도 반영됩니다. 다시 작성할까요?'
    )
  })

  it('편집 안 된 회의록이면 기존 문구', async () => {
    getAiOriginalMock.mockResolvedValue({ available: true, human_edited_at: null, diff: [] })
    const { result } = renderHook(() => useNotesRegeneration(1, options))
    await act(async () => { await result.current.requestNotesConfirm() })
    expect(result.current.showNotesConfirm).toBe(true)
    expect(result.current.notesConfirmMessage).toContain('처음부터 다시 생성합니다')
  })

  it('조회 실패여도 기존 문구로 확인창을 연다', async () => {
    getAiOriginalMock.mockRejectedValue(new Error('x'))
    const { result } = renderHook(() => useNotesRegeneration(1, options))
    await act(async () => { await result.current.requestNotesConfirm() })
    expect(result.current.showNotesConfirm).toBe(true)
    expect(result.current.notesConfirmMessage).toContain('처음부터 다시 생성합니다')
  })

  it('고쳤지만 학습이 꺼져 있으면 용어 유지 문구 없이 안내', async () => {
    getAiOriginalMock.mockResolvedValue({ available: true, human_edited_at: '2026-11-24T00:00:00Z', diff: [], stt_learning_enabled: false })
    const { result } = renderHook(() => useNotesRegeneration(1, options))
    await act(async () => { await result.current.requestNotesConfirm() })
    expect(result.current.notesConfirmMessage).toBe('직접 고친 내용은 새로 작성됩니다. 다시 작성할까요?')
  })

  it('조회 중 재호출은 무시하고 조회 중 상태를 노출한다', async () => {
    let resolve!: (v: unknown) => void
    getAiOriginalMock.mockReturnValue(new Promise((r) => { resolve = r }))
    const { result } = renderHook(() => useNotesRegeneration(1, options))
    let p1!: Promise<void>
    act(() => {
      p1 = result.current.requestNotesConfirm()
      void result.current.requestNotesConfirm()
    })
    expect(result.current.isCheckingNotesConfirm).toBe(true)
    expect(getAiOriginalMock).toHaveBeenCalledTimes(1)
    await act(async () => { resolve({ available: false, human_edited_at: null, diff: [] }); await p1 })
    expect(result.current.isCheckingNotesConfirm).toBe(false)
    expect(result.current.showNotesConfirm).toBe(true)
  })
})
