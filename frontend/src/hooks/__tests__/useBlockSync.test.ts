import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { RefObject } from 'react'
import { useBlockSync } from '../useBlockSync'
import * as blocksApi from '../../api/blocks'
import type { ApiBlock } from '../../api/blocks'

// API 모듈 전체 mock
vi.mock('../../api/blocks')

const mockedGetBlocks = vi.mocked(blocksApi.getBlocks)
const mockedCreateBlock = vi.mocked(blocksApi.createBlock)
const mockedUpdateBlock = vi.mocked(blocksApi.updateBlock)
const mockedDeleteBlock = vi.mocked(blocksApi.deleteBlock)
const mockedReorderBlock = vi.mocked(blocksApi.reorderBlock)

function makeApiBlock(overrides: Partial<ApiBlock> = {}): ApiBlock {
  return {
    id: 1,
    meeting_id: 10,
    block_type: 'text',
    content: '안녕하세요',
    position: 1.0,
    parent_block_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

// 최소한의 CustomBlock mock
function makeEditorBlock(overrides: Record<string, unknown> = {}): {
  id: string
  type: string
  props: Record<string, unknown>
  content: Array<{ type: string; text: string }>
  children: []
} {
  return {
    id: 'block-uuid-1',
    type: 'paragraph',
    props: {},
    content: [{ type: 'text', text: '안녕하세요' }],
    children: [],
    ...overrides,
  }
}

describe('useBlockSync', () => {
  let editorRef: RefObject<null>

  beforeEach(() => {
    editorRef = { current: null }
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('초기 로드', () => {
    it('마운트 시 getBlocks를 호출하고 initialContent를 설정한다', async () => {
      const apiBlocks = [makeApiBlock({ id: 1, block_type: 'text', content: '첫 번째' })]
      mockedGetBlocks.mockResolvedValue(apiBlocks)

      const { result } = renderHook(() =>
        useBlockSync({ meetingId: 10, editorRef })
      )

      expect(result.current.isLoading).toBe(true)

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(mockedGetBlocks).toHaveBeenCalledWith(10)
      expect(result.current.initialContent).not.toBeNull()
      expect(result.current.initialContent).toHaveLength(1)
      expect(result.current.error).toBeNull()
    })

    it('초기 로드 성공 시 isLoading이 false로 전환된다', async () => {
      mockedGetBlocks.mockResolvedValue([])

      const { result } = renderHook(() =>
        useBlockSync({ meetingId: 10, editorRef })
      )

      expect(result.current.isLoading).toBe(true)

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })
    })

    it('초기 로드 실패 시 error 상태가 설정된다', async () => {
      mockedGetBlocks.mockRejectedValue(new Error('네트워크 오류'))

      const { result } = renderHook(() =>
        useBlockSync({ meetingId: 10, editorRef })
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.error).toBe('네트워크 오류')
      expect(result.current.initialContent).toBeNull()
    })

    it('빈 블록 배열 → initialContent가 null로 설정된다 (에디터 기본 콘텐츠 사용)', async () => {
      mockedGetBlocks.mockResolvedValue([])

      const { result } = renderHook(() =>
        useBlockSync({ meetingId: 10, editorRef })
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.initialContent).toBeNull()
    })
  })

  describe('블록 추가 감지', () => {
    it('새 블록 등장 시 createBlock이 호출된다', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      mockedGetBlocks.mockResolvedValue([])
      mockedCreateBlock.mockResolvedValue(makeApiBlock({ id: 99 }))

      const { result } = renderHook(() =>
        useBlockSync({ meetingId: 10, editorRef, debounceMs: 800 })
      )

      await waitFor(() => expect(result.current.isLoading).toBe(false))

      const newBlock = makeEditorBlock({ id: 'new-uuid-1', type: 'paragraph' })

      act(() => {
        result.current.onEditorChange([newBlock] as Parameters<typeof result.current.onEditorChange>[0])
      })

      // 디바운스 전에는 아직 호출 안됨
      expect(mockedCreateBlock).not.toHaveBeenCalled()

      // 디바운스 시간 경과
      await act(async () => {
        vi.advanceTimersByTime(800)
      })

      await waitFor(() => {
        expect(mockedCreateBlock).toHaveBeenCalledWith(
          10,
          expect.objectContaining({ block_type: 'text' })
        )
      })
    })
  })

  describe('블록 수정 감지', () => {
    it('content 변경 시 updateBlock이 호출된다', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const apiBlocks = [makeApiBlock({ id: 1, block_type: 'text', content: '원본' })]
      mockedGetBlocks.mockResolvedValue(apiBlocks)
      mockedUpdateBlock.mockResolvedValue(makeApiBlock({ id: 1, content: '수정됨' }))

      const { result } = renderHook(() =>
        useBlockSync({ meetingId: 10, editorRef, debounceMs: 800 })
      )

      await waitFor(() => expect(result.current.isLoading).toBe(false))

      // 에디터 마운트 후 에디터에서 생성된 UUID로 최초 onChange 호출 → 매핑 구성
      const BLOCK_UUID = 'editor-uuid-from-blocknote'
      const originalBlock = makeEditorBlock({
        id: BLOCK_UUID,
        type: 'paragraph',
        content: [{ type: 'text', text: '원본' }],
      })

      // 첫 onChange: 초기 상태 (서버 블록 1개 ↔ 에디터 블록 1개 매핑 구성)
      act(() => {
        result.current.onEditorChange([originalBlock] as Parameters<typeof result.current.onEditorChange>[0])
      })

      // 첫 디바운스 flush (content 동일하므로 update 없음)
      await act(async () => {
        vi.advanceTimersByTime(800)
      })

      // 수정된 내용으로 두 번째 onChange 호출
      const modifiedBlock = makeEditorBlock({
        id: BLOCK_UUID,
        type: 'paragraph',
        content: [{ type: 'text', text: '수정됨' }],
      })

      act(() => {
        result.current.onEditorChange([modifiedBlock] as Parameters<typeof result.current.onEditorChange>[0])
      })

      await act(async () => {
        vi.advanceTimersByTime(800)
      })

      await waitFor(() => {
        expect(mockedUpdateBlock).toHaveBeenCalledWith(
          10,
          1,
          expect.objectContaining({ content: '수정됨' })
        )
      })
    })
  })

  describe('블록 삭제 감지', () => {
    it('블록이 사라지면 deleteBlock이 호출된다', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const apiBlocks = [makeApiBlock({ id: 1 })]
      mockedGetBlocks.mockResolvedValue(apiBlocks)
      mockedDeleteBlock.mockResolvedValue(undefined)

      const { result } = renderHook(() =>
        useBlockSync({ meetingId: 10, editorRef, debounceMs: 800 })
      )

      await waitFor(() => expect(result.current.isLoading).toBe(false))

      // 초기 onEditorChange로 매핑 구성 (initialBlocks와 동일한 uuid 사용)
      const initialBlocks = result.current.initialContent!
      const blockId = initialBlocks[0].id as string

      const existingBlock = makeEditorBlock({ id: blockId })

      // 먼저 initialContent를 포함한 상태로 onChange를 한 번 호출하여 매핑 구성
      act(() => {
        result.current.onEditorChange([existingBlock] as Parameters<typeof result.current.onEditorChange>[0])
      })

      // 디바운스 시간 경과 (변경 없음이므로 API 호출 없음)
      await act(async () => {
        vi.advanceTimersByTime(800)
      })

      // 이제 빈 배열 = 모든 블록 삭제
      act(() => {
        result.current.onEditorChange([] as Parameters<typeof result.current.onEditorChange>[0])
      })

      await act(async () => {
        vi.advanceTimersByTime(800)
      })

      await waitFor(() => {
        expect(mockedDeleteBlock).toHaveBeenCalledWith(10, 1)
      })
    })
  })

  describe('블록 순서 변경', () => {
    it('UUID 배열 순서 변경 시 reorderBlock이 호출된다', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const apiBlocks = [
        makeApiBlock({ id: 1, position: 1.0, content: 'A' }),
        makeApiBlock({ id: 2, position: 2.0, content: 'B' }),
      ]
      mockedGetBlocks.mockResolvedValue(apiBlocks)
      mockedReorderBlock.mockResolvedValue({
        block: makeApiBlock({ id: 2 }),
        rebalanced: false,
      })

      const { result } = renderHook(() =>
        useBlockSync({ meetingId: 10, editorRef, debounceMs: 800 })
      )

      await waitFor(() => expect(result.current.isLoading).toBe(false))

      // 고정 UUID 사용 (에디터에서 생성한 UUID를 시뮬레이션)
      const UUID_A = 'uuid-block-A'
      const UUID_B = 'uuid-block-B'

      // 첫 onChange: 초기 순서로 매핑 구성 (apiBlocks[0] ↔ UUID_A, apiBlocks[1] ↔ UUID_B)
      const origOrder = [
        makeEditorBlock({ id: UUID_A, type: 'paragraph', content: [{ type: 'text', text: 'A' }] }),
        makeEditorBlock({ id: UUID_B, type: 'paragraph', content: [{ type: 'text', text: 'B' }] }),
      ]

      act(() => {
        result.current.onEditorChange(origOrder as Parameters<typeof result.current.onEditorChange>[0])
      })

      await act(async () => {
        vi.advanceTimersByTime(800)
      })

      // 순서를 뒤집어서 변경 전달 (B, A 순서)
      const reordered = [
        makeEditorBlock({ id: UUID_B, type: 'paragraph', content: [{ type: 'text', text: 'B' }] }),
        makeEditorBlock({ id: UUID_A, type: 'paragraph', content: [{ type: 'text', text: 'A' }] }),
      ]

      act(() => {
        result.current.onEditorChange(reordered as Parameters<typeof result.current.onEditorChange>[0])
      })

      await act(async () => {
        vi.advanceTimersByTime(800)
      })

      await waitFor(() => {
        expect(mockedReorderBlock).toHaveBeenCalled()
      })
    })
  })

  describe('디바운스', () => {
    it('연속 변경 시 API가 한 번만 호출된다', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      mockedGetBlocks.mockResolvedValue([])
      mockedCreateBlock.mockResolvedValue(makeApiBlock({ id: 99 }))

      const { result } = renderHook(() =>
        useBlockSync({ meetingId: 10, editorRef, debounceMs: 800 })
      )

      await waitFor(() => expect(result.current.isLoading).toBe(false))

      const block1 = makeEditorBlock({ id: 'uuid-1', type: 'paragraph', content: [{ type: 'text', text: '첫 번째' }] })
      const block2 = makeEditorBlock({ id: 'uuid-1', type: 'paragraph', content: [{ type: 'text', text: '두 번째' }] })
      const block3 = makeEditorBlock({ id: 'uuid-1', type: 'paragraph', content: [{ type: 'text', text: '세 번째' }] })

      act(() => {
        result.current.onEditorChange([block1] as Parameters<typeof result.current.onEditorChange>[0])
      })
      act(() => {
        result.current.onEditorChange([block2] as Parameters<typeof result.current.onEditorChange>[0])
      })
      act(() => {
        result.current.onEditorChange([block3] as Parameters<typeof result.current.onEditorChange>[0])
      })

      // 디바운스 전 → 아직 0번
      expect(mockedCreateBlock).not.toHaveBeenCalled()

      await act(async () => {
        vi.advanceTimersByTime(800)
      })

      // 디바운스 후 → 1번만 호출
      await waitFor(() => {
        expect(mockedCreateBlock).toHaveBeenCalledTimes(1)
      })
    })

    it('800ms가 지나기 전에는 API를 호출하지 않는다', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      mockedGetBlocks.mockResolvedValue([])
      mockedCreateBlock.mockResolvedValue(makeApiBlock({ id: 99 }))

      const { result } = renderHook(() =>
        useBlockSync({ meetingId: 10, editorRef, debounceMs: 800 })
      )

      await waitFor(() => expect(result.current.isLoading).toBe(false))

      const block = makeEditorBlock({ id: 'uuid-new' })

      act(() => {
        result.current.onEditorChange([block] as Parameters<typeof result.current.onEditorChange>[0])
      })

      // 500ms만 경과 (800ms 미만)
      act(() => {
        vi.advanceTimersByTime(500)
      })

      expect(mockedCreateBlock).not.toHaveBeenCalled()
    })
  })

  describe('저장 중 상태', () => {
    it('API 저장 중 isSaving가 true로 전환된다', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      mockedGetBlocks.mockResolvedValue([])

      let resolveCreate!: (val: ApiBlock) => void
      mockedCreateBlock.mockImplementation(
        () => new Promise<ApiBlock>((resolve) => { resolveCreate = resolve })
      )

      const { result } = renderHook(() =>
        useBlockSync({ meetingId: 10, editorRef, debounceMs: 800 })
      )

      await waitFor(() => expect(result.current.isLoading).toBe(false))

      const block = makeEditorBlock({ id: 'uuid-new' })

      act(() => {
        result.current.onEditorChange([block] as Parameters<typeof result.current.onEditorChange>[0])
      })

      await act(async () => {
        vi.advanceTimersByTime(800)
      })

      // 저장 중
      await waitFor(() => {
        expect(result.current.isSaving).toBe(true)
      })

      // 저장 완료
      await act(async () => {
        resolveCreate(makeApiBlock({ id: 99 }))
      })

      await waitFor(() => {
        expect(result.current.isSaving).toBe(false)
      })
    })
  })
})
