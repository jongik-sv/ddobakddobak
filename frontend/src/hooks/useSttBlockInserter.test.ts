import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { RefObject } from 'react'
import { useSttBlockInserter } from './useSttBlockInserter'
import { useTranscriptStore } from '../stores/transcriptStore'
import type { TranscriptFinalData } from '../channels/transcription'

// BlockNoteEditor mock 타입
interface MockEditor {
  document: Array<{ id: string; type: string }>
  insertBlocks: ReturnType<typeof vi.fn>
}

function makeMockEditor(): MockEditor {
  return {
    document: [{ id: 'block-0', type: 'paragraph' }],
    insertBlocks: vi.fn(),
  }
}

function makeFinal(overrides: Partial<TranscriptFinalData> = {}): TranscriptFinalData {
  return {
    id: 1,
    content: '안녕하세요',
    speaker_label: 'SPEAKER_00',
    started_at_ms: 0,
    ended_at_ms: 1000,
    sequence_number: 1,
    ...overrides,
  }
}

describe('useSttBlockInserter', () => {
  beforeEach(() => {
    // 각 테스트마다 store 초기화
    useTranscriptStore.getState().reset()
    vi.clearAllMocks()
  })

  it('editorRef.current가 null이면 insertBlocks가 호출되지 않는다', () => {
    const editorRef: RefObject<MockEditor | null> = { current: null }

    // finals에 항목 추가 후 훅 마운트
    act(() => {
      useTranscriptStore.getState().addFinal(makeFinal())
    })

    renderHook(() =>
      useSttBlockInserter(editorRef as RefObject<unknown | null>)
    )

    // editor가 null이므로 insertBlocks 호출 없음 (editor 자체가 null)
    expect(editorRef.current).toBeNull()
  })

  it('훅 마운트 시 이미 존재하는 finals 항목이 에디터에 삽입된다 (초기 동기화)', () => {
    const editor = makeMockEditor()
    const editorRef: RefObject<MockEditor | null> = { current: editor }

    act(() => {
      useTranscriptStore.getState().addFinal(makeFinal({ id: 1, content: '첫 번째' }))
      useTranscriptStore.getState().addFinal(makeFinal({ id: 2, content: '두 번째' }))
    })

    renderHook(() =>
      useSttBlockInserter(editorRef as RefObject<unknown | null>)
    )

    expect(editor.insertBlocks).toHaveBeenCalledTimes(2)
  })

  it('훅 마운트 후 addFinal 호출 시 신규 블록 1개만 추가된다 (증분 삽입)', () => {
    const editor = makeMockEditor()
    const editorRef: RefObject<MockEditor | null> = { current: editor }

    renderHook(() =>
      useSttBlockInserter(editorRef as RefObject<unknown | null>)
    )

    // 마운트 시점에 finals 없으므로 초기 insertBlocks 호출 없음
    expect(editor.insertBlocks).toHaveBeenCalledTimes(0)

    act(() => {
      useTranscriptStore.getState().addFinal(makeFinal({ id: 1, content: '신규 항목' }))
    })

    expect(editor.insertBlocks).toHaveBeenCalledTimes(1)
    const callArg = editor.insertBlocks.mock.calls[0][0]
    expect(callArg[0]).toMatchObject({
      type: 'transcript',
      props: { text: '신규 항목', speakerLabel: 'SPEAKER_00' },
    })
  })

  it('동일 final이 두 번 삽입되지 않는다 (중복 방지)', () => {
    const editor = makeMockEditor()
    const editorRef: RefObject<MockEditor | null> = { current: editor }

    renderHook(() =>
      useSttBlockInserter(editorRef as RefObject<unknown | null>)
    )

    act(() => {
      useTranscriptStore.getState().addFinal(makeFinal({ id: 1 }))
    })

    act(() => {
      useTranscriptStore.getState().addFinal(makeFinal({ id: 2 }))
    })

    // 각각 1번씩만 호출 → 총 2번
    expect(editor.insertBlocks).toHaveBeenCalledTimes(2)
  })

  it('insertBlocks 호출 시 올바른 블록 형식과 위치가 전달된다', () => {
    const editor = makeMockEditor()
    const editorRef: RefObject<MockEditor | null> = { current: editor }

    renderHook(() =>
      useSttBlockInserter(editorRef as RefObject<unknown | null>)
    )

    act(() => {
      useTranscriptStore.getState().addFinal(
        makeFinal({ content: '테스트', speaker_label: 'SPEAKER_01' })
      )
    })

    expect(editor.insertBlocks).toHaveBeenCalledTimes(1)
    const [blocks, referenceBlock, placement] = editor.insertBlocks.mock.calls[0]
    expect(blocks[0]).toMatchObject({
      type: 'transcript',
      props: { speakerLabel: 'SPEAKER_01', text: '테스트' },
    })
    expect(referenceBlock).toBeDefined()
    expect(placement).toBe('after')
  })

  it('transcriptStore.reset() 후 새로 addFinal하면 처음부터 삽입된다', () => {
    const editor = makeMockEditor()
    const editorRef: RefObject<MockEditor | null> = { current: editor }

    const { rerender } = renderHook(() =>
      useSttBlockInserter(editorRef as RefObject<unknown | null>)
    )

    act(() => {
      useTranscriptStore.getState().addFinal(makeFinal({ id: 1 }))
    })
    expect(editor.insertBlocks).toHaveBeenCalledTimes(1)

    act(() => {
      useTranscriptStore.getState().reset()
    })

    rerender()

    act(() => {
      useTranscriptStore.getState().addFinal(makeFinal({ id: 2, content: '리셋 후 새 항목' }))
    })

    // reset 후 새 항목 추가 → 1번 더 호출 (총 2번)
    expect(editor.insertBlocks).toHaveBeenCalledTimes(2)
  })
})
