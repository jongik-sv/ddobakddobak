import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMemoEditor } from './useMemoEditor'

vi.mock('../api/meetings', () => ({ updateMemo: vi.fn(async () => {}) }))

function makeEditor() {
  return {
    document: [],
    tryParseMarkdownToBlocks: vi.fn(async (md: string) => [{ type: 'paragraph', content: md }]),
    replaceBlocks: vi.fn(),
    blocksToMarkdownLossy: vi.fn(async () => ''),
  }
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

describe('useMemoEditor — 에디터 리마운트 시 메모 재로드', () => {
  beforeEach(() => vi.clearAllMocks())

  it('onEditorReady 로 새 에디터 인스턴스가 마운트되면 메모를 로드한다', async () => {
    const { result } = renderHook(() => useMemoEditor(1, '내 메모'))

    const editorA = makeEditor()
    act(() => result.current.onEditorReady(editorA as never))
    await flush()
    expect(editorA.replaceBlocks).toHaveBeenCalledTimes(1)

    // transcribing → completed 로 에디터가 언마운트 후 새 인스턴스로 리마운트
    const editorB = makeEditor()
    act(() => result.current.onEditorReady(editorB as never))
    await flush()
    // 버그(meetingId 1회 가드)면 여기서 호출 안 됨 → 빈 메모
    expect(editorB.replaceBlocks).toHaveBeenCalledTimes(1)
  })

  it('같은 에디터 인스턴스로 다시 불려도 재로드 안 함(사용자 편집 보존)', async () => {
    const { result } = renderHook(() => useMemoEditor(1, '내 메모'))

    const editorA = makeEditor()
    act(() => result.current.onEditorReady(editorA as never))
    await flush()
    act(() => result.current.onEditorReady(editorA as never))
    await flush()
    expect(editorA.replaceBlocks).toHaveBeenCalledTimes(1)
  })

  it('메모가 없으면 로드하지 않는다', async () => {
    const { result } = renderHook(() => useMemoEditor(1, null))
    const editorA = makeEditor()
    act(() => result.current.onEditorReady(editorA as never))
    await flush()
    expect(editorA.replaceBlocks).not.toHaveBeenCalled()
  })
})
