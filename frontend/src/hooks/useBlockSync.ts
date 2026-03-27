import { useState, useEffect, useRef, useCallback } from 'react'
import type { RefObject } from 'react'
import type { PartialBlock } from '@blocknote/core'
import type { customSchema } from '../components/editor/MeetingEditor'
import type { BlockNoteEditor } from '@blocknote/core'
import {
  getBlocks,
  createBlock,
  updateBlock,
  deleteBlock,
  reorderBlock,
} from '../api/blocks'
import type { ApiBlock } from '../api/blocks'
import {
  apiBlocksToEditorBlocks,
  toApiBlockType,
  extractTextContent,
} from '../lib/blockAdapter'

type CustomBlock = {
  id: string
  type: string
  props: Record<string, unknown>
  content: Array<{ type: string; text?: string }>
  children: CustomBlock[]
}

interface BlockDiff {
  added: CustomBlock[]
  updated: CustomBlock[]
  deleted: string[] // BlockNote UUID
  reordered: Array<{
    block: CustomBlock
    prevBlockId: number | null
    nextBlockId: number | null
  }>
}

interface UseBlockSyncOptions {
  meetingId: number
  editorRef: RefObject<BlockNoteEditor<typeof customSchema.blockSchema> | null>
  debounceMs?: number
}

interface UseBlockSyncReturn {
  isLoading: boolean
  isSaving: boolean
  error: string | null
  initialContent: PartialBlock[] | null
  onEditorChange: (blocks: CustomBlock[]) => void
}

/**
 * 이전 블록 배열과 현재 블록 배열을 비교해 diff를 계산한다.
 */
function computeDiff(
  prev: CustomBlock[],
  curr: CustomBlock[],
  idMap: Map<string, number>
): BlockDiff {
  const prevMap = new Map(prev.map((b) => [b.id, b]))
  const currMap = new Map(curr.map((b) => [b.id, b]))

  const added: CustomBlock[] = []
  const updated: CustomBlock[] = []
  const deleted: string[] = []
  const reordered: BlockDiff['reordered'] = []

  // 삭제된 블록: prev에 있고 curr에 없는 것
  for (const [id] of prevMap) {
    if (!currMap.has(id)) {
      deleted.push(id)
    }
  }

  // 추가/수정 감지
  for (const [id, currBlock] of currMap) {
    if (!prevMap.has(id)) {
      // 신규 추가
      added.push(currBlock)
    } else {
      // 기존 블록: content 또는 type 변경 감지
      const prevBlock = prevMap.get(id)!
      const prevText = extractTextContent(prevBlock)
      const currText = extractTextContent(currBlock)
      const prevApiType = toApiBlockType(prevBlock.type, prevBlock.props)
      const currApiType = toApiBlockType(currBlock.type, currBlock.props)

      if (prevText !== currText || prevApiType !== currApiType) {
        updated.push(currBlock)
      }
    }
  }

  // 순서 변경 감지: 기존 블록들의 순서 비교
  const prevIds = prev.map((b) => b.id).filter((id) => currMap.has(id))
  const currIds = curr.map((b) => b.id).filter((id) => prevMap.has(id))

  const orderChanged = prevIds.some((id, i) => currIds[i] !== id)
  if (orderChanged) {
    // 순서가 바뀐 블록들을 reordered에 추가
    for (let i = 0; i < curr.length; i++) {
      const block = curr[i]
      // 신규 추가 블록은 create 후 처리
      if (!prevMap.has(block.id)) continue

      const prevIdx = prevIds.indexOf(block.id)
      const currIdx = currIds.indexOf(block.id)
      if (prevIdx !== currIdx) {
        const prevBlockInCurr = i > 0 ? curr[i - 1] : null
        const nextBlockInCurr = i < curr.length - 1 ? curr[i + 1] : null

        const prevDbId = prevBlockInCurr ? (idMap.get(prevBlockInCurr.id) ?? null) : null
        const nextDbId = nextBlockInCurr ? (idMap.get(nextBlockInCurr.id) ?? null) : null

        reordered.push({
          block,
          prevBlockId: prevDbId,
          nextBlockId: nextDbId,
        })
      }
    }
  }

  return { added, updated, deleted, reordered }
}

export function useBlockSync({
  meetingId,
  editorRef: _editorRef,
  debounceMs = 800,
}: UseBlockSyncOptions): UseBlockSyncReturn {
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [initialContent, setInitialContent] = useState<PartialBlock[] | null>(null)

  // BlockNote UUID → DB id 매핑
  const idMapRef = useRef<Map<string, number>>(new Map())

  // 이전 블록 스냅샷
  const prevBlocksRef = useRef<CustomBlock[]>([])

  // 디바운스 타이머
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 현재 블록 (디바운스 flush용)
  const pendingBlocksRef = useRef<CustomBlock[]>([])

  // 초기 API 블록 순서 보관 (첫 onChange 시 순서 기반 UUID ↔ DB id 매핑 구성에 사용)
  const initialApiBlocksRef = useRef<ApiBlock[]>([])
  const mappingBuiltRef = useRef(false)

  // 초기 로드
  useEffect(() => {
    setIsLoading(true)
    setError(null)

    getBlocks(meetingId)
      .then((apiBlocks: ApiBlock[]) => {
        initialApiBlocksRef.current = apiBlocks
        const blocks = apiBlocksToEditorBlocks(apiBlocks)
        setInitialContent(blocks.length > 0 ? blocks : null)
      })
      .catch((err: Error) => {
        setError(err.message)
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [meetingId])

  /**
   * 첫 onChange 시 에디터 UUID와 서버 DB id를 매핑한다.
   */
  const buildInitialMapping = useCallback((currentBlocks: CustomBlock[]) => {
    if (mappingBuiltRef.current) return
    const apiBlocks = initialApiBlocksRef.current
    if (apiBlocks.length === 0) return

    // 순서 기반 매핑: 에디터 블록 순서 == API 블록 순서
    const count = Math.min(apiBlocks.length, currentBlocks.length)
    for (let i = 0; i < count; i++) {
      idMapRef.current.set(currentBlocks[i].id, apiBlocks[i].id)
    }

    prevBlocksRef.current = currentBlocks
    mappingBuiltRef.current = true
  }, [])

  /**
   * 변경 사항을 API로 flush한다.
   */
  const flushChanges = useCallback(
    async (currentBlocks: CustomBlock[]) => {
      const prev = prevBlocksRef.current
      const diff = computeDiff(prev, currentBlocks, idMapRef.current)

      const hasChanges =
        diff.added.length > 0 ||
        diff.updated.length > 0 ||
        diff.deleted.length > 0 ||
        diff.reordered.length > 0

      if (!hasChanges) return

      setIsSaving(true)
      setError(null)

      try {
        // 삭제
        await Promise.all(
          diff.deleted.map((uuid) => {
            const dbId = idMapRef.current.get(uuid)
            if (dbId == null) return Promise.resolve()
            idMapRef.current.delete(uuid)
            return deleteBlock(meetingId, dbId)
          })
        )

        // 추가 (순서: 현재 배열에서의 위치 기반 position 계산)
        await Promise.all(
          diff.added.map(async (block) => {
            const idx = currentBlocks.findIndex((b) => b.id === block.id)
            const position = idx + 1 // 단순 1-based 인덱스 (서버에서 fractional indexing 처리)
            const apiType = toApiBlockType(block.type, block.props)
            const content = extractTextContent(block)

            const apiBlock = await createBlock(meetingId, {
              block_type: apiType,
              content,
              position,
              parent_block_id: null,
            })

            idMapRef.current.set(block.id, apiBlock.id)
          })
        )

        // 수정
        await Promise.all(
          diff.updated.map((block) => {
            const dbId = idMapRef.current.get(block.id)
            if (dbId == null) return Promise.resolve()
            const apiType = toApiBlockType(block.type, block.props)
            const content = extractTextContent(block)
            return updateBlock(meetingId, dbId, { block_type: apiType, content })
          })
        )

        // 순서 변경
        await Promise.all(
          diff.reordered.map(({ block, prevBlockId, nextBlockId }) => {
            const dbId = idMapRef.current.get(block.id)
            if (dbId == null) return Promise.resolve()
            return reorderBlock(meetingId, dbId, {
              prev_block_id: prevBlockId,
              next_block_id: nextBlockId,
            }).then((res) => {
              // rebalance 발생 시 서버에서 반환된 전체 블록으로 ID 매핑 재구성
              if (res.rebalanced && res.blocks) {
                res.blocks.forEach((apiBlock) => {
                  const bnBlock = currentBlocks.find(
                    (b) => idMapRef.current.get(b.id) === apiBlock.id
                  )
                  if (bnBlock) {
                    idMapRef.current.set(bnBlock.id, apiBlock.id)
                  }
                })
              }
            })
          })
        )

        prevBlocksRef.current = currentBlocks
      } catch (err) {
        const message = err instanceof Error ? err.message : '저장 실패'
        setError(message)
      } finally {
        setIsSaving(false)
      }
    },
    [meetingId]
  )

  /**
   * MeetingEditor의 onChange에 연결할 핸들러
   */
  const onEditorChange = useCallback(
    (currentBlocks: CustomBlock[]) => {
      // 첫 onChange 시 초기 매핑 구성
      if (!mappingBuiltRef.current) {
        buildInitialMapping(currentBlocks)
      }

      pendingBlocksRef.current = currentBlocks

      // 디바운스 타이머 리셋
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }

      debounceTimerRef.current = setTimeout(() => {
        flushChanges(pendingBlocksRef.current)
      }, debounceMs)
    },
    [buildInitialMapping, flushChanges, debounceMs]
  )

  // 언마운트 시 타이머 정리
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [])

  return {
    isLoading,
    isSaving,
    error,
    initialContent,
    onEditorChange,
  }
}
