import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { EditableTranscriptText } from './EditableTranscriptText'
import { useTranscriptStore } from '../../stores/transcriptStore'

vi.mock('../../api/meetings', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>)
  return {
    ...actual,
    updateTranscript: vi.fn(async (_mId: number, _tId: number, content: string) => ({
      id: _tId, speaker_label: 'A', content,
      started_at_ms: 0, ended_at_ms: 1000, sequence_number: 1,
    })),
  }
})

import { updateTranscript } from '../../api/meetings'

beforeEach(() => {
  useTranscriptStore.setState({
    partial: null,
    finals: [
      { id: 1, content: '원본', speaker_label: 'A', started_at_ms: 0, ended_at_ms: 1000, sequence_number: 1, applied: false },
    ],
    appliedIds: new Set(),
    meetingNotes: null,
    currentSpeaker: null,
    isSummarizing: false,
    summarizationKind: null,
    lastUserEditAt: 0,
    lastResetAt: 0,
  })
  vi.clearAllMocks()
})

describe('EditableTranscriptText', () => {
  it('editable=false면 더블클릭해도 편집 모드로 진입하지 않는다', () => {
    render(
      <EditableTranscriptText transcriptId={1} meetingId={10} content="원본" editable={false} />,
    )
    const span = screen.getByText('원본')
    fireEvent.doubleClick(span)
    expect(span.getAttribute('contenteditable')).not.toBe('true')
  })

  it('포커스된 상태에서 Enter → 편집 진입', () => {
    render(
      <EditableTranscriptText transcriptId={1} meetingId={10} content="원본" editable />,
    )
    const span = screen.getByText('원본')
    fireEvent.keyDown(span, { key: 'Enter' })
    expect(span.getAttribute('contenteditable')).toBe('true')
  })

  it('editable=false면 Enter 눌러도 편집 진입하지 않는다', () => {
    render(
      <EditableTranscriptText transcriptId={1} meetingId={10} content="원본" editable={false} />,
    )
    const span = screen.getByText('원본')
    fireEvent.keyDown(span, { key: 'Enter' })
    expect(span.getAttribute('contenteditable')).not.toBe('true')
  })

  it('editable이면 tabIndex=0 (키보드 포커스 가능)', () => {
    render(
      <EditableTranscriptText transcriptId={1} meetingId={10} content="원본" editable />,
    )
    const span = screen.getByText('원본')
    expect(span.getAttribute('tabindex')).toBe('0')
  })

  it('더블클릭 → 편집 진입, 상위 onClick은 호출되지 않는다', () => {
    const onParentClick = vi.fn()
    render(
      <div onClick={onParentClick}>
        <EditableTranscriptText transcriptId={1} meetingId={10} content="원본" editable />
      </div>,
    )
    const span = screen.getByText('원본')
    fireEvent.doubleClick(span)
    expect(span.getAttribute('contenteditable')).toBe('true')
    expect(onParentClick).not.toHaveBeenCalled()
  })

  it('Enter → 저장 호출, store 즉시 갱신', async () => {
    render(
      <EditableTranscriptText transcriptId={1} meetingId={10} content="원본" editable />,
    )
    const span = screen.getByText('원본')
    fireEvent.doubleClick(span)
    span.textContent = '수정됨'
    fireEvent.keyDown(span, { key: 'Enter' })

    await waitFor(() =>
      expect(updateTranscript).toHaveBeenCalledWith(10, 1, '수정됨', expect.any(String)),
    )
    expect(useTranscriptStore.getState().finals[0].content).toBe('수정됨')
  })

  it('Esc → 취소, API 호출 없음, store 원본 유지', () => {
    render(
      <EditableTranscriptText transcriptId={1} meetingId={10} content="원본" editable />,
    )
    const span = screen.getByText('원본')
    fireEvent.doubleClick(span)
    span.textContent = '편집중'
    fireEvent.keyDown(span, { key: 'Escape' })
    expect(updateTranscript).not.toHaveBeenCalled()
    expect(useTranscriptStore.getState().finals[0].content).toBe('원본')
    expect(span.getAttribute('contenteditable')).not.toBe('true')
  })

  it('변경 없음 → API 호출 없이 종료', async () => {
    render(
      <EditableTranscriptText transcriptId={1} meetingId={10} content="원본" editable />,
    )
    const span = screen.getByText('원본')
    fireEvent.doubleClick(span)
    fireEvent.keyDown(span, { key: 'Enter' })
    expect(updateTranscript).not.toHaveBeenCalled()
  })

  it('공백만 → API 호출 없이 취소 처리', () => {
    render(
      <EditableTranscriptText transcriptId={1} meetingId={10} content="원본" editable />,
    )
    const span = screen.getByText('원본')
    fireEvent.doubleClick(span)
    span.textContent = '   '
    fireEvent.keyDown(span, { key: 'Enter' })
    expect(updateTranscript).not.toHaveBeenCalled()
    expect(useTranscriptStore.getState().finals[0].content).toBe('원본')
  })

  it('Shift+Enter → 저장하지 않음 (줄바꿈 허용)', () => {
    render(
      <EditableTranscriptText transcriptId={1} meetingId={10} content="원본" editable />,
    )
    const span = screen.getByText('원본')
    fireEvent.doubleClick(span)
    fireEvent.keyDown(span, { key: 'Enter', shiftKey: true })
    expect(updateTranscript).not.toHaveBeenCalled()
    expect(span.getAttribute('contenteditable')).toBe('true')
  })

  it('blur → 저장', async () => {
    render(
      <EditableTranscriptText transcriptId={1} meetingId={10} content="원본" editable />,
    )
    const span = screen.getByText('원본')
    fireEvent.doubleClick(span)
    span.textContent = '블러저장'
    fireEvent.blur(span)
    await waitFor(() =>
      expect(updateTranscript).toHaveBeenCalledWith(10, 1, '블러저장', expect.any(String)),
    )
  })

  it('API 실패 시 store 롤백', async () => {
    ;(updateTranscript as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('boom'),
    )
    render(
      <EditableTranscriptText transcriptId={1} meetingId={10} content="원본" editable />,
    )
    const span = screen.getByText('원본')
    fireEvent.doubleClick(span)
    span.textContent = '실패예정'
    fireEvent.keyDown(span, { key: 'Enter' })
    await waitFor(() =>
      expect(useTranscriptStore.getState().finals[0].content).toBe('원본'),
    )
  })
})
