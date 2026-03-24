import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { useTranscriptStore } from '../stores/transcriptStore'
import { finalToBlock } from '../lib/transcriptBlocks'

interface MinimalEditor {
  document: Array<{ id: string; type: string }>
  insertBlocks: (
    blocks: Array<{ type: string; props: Record<string, string> }>,
    referenceBlock: { id: string; type: string },
    placement: 'before' | 'after'
  ) => void
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useSttBlockInserter(editorRef: RefObject<any | null>): void {
  const finals = useTranscriptStore((s) => s.finals)
  const processedCountRef = useRef(0)

  useEffect(() => {
    // finals가 reset되어 길이가 0이 되면 processedCountRef도 초기화
    if (finals.length === 0) {
      processedCountRef.current = 0
      return
    }

    const editor = editorRef.current as MinimalEditor | null
    if (!editor) return

    const newFinals = finals.slice(processedCountRef.current)
    if (newFinals.length === 0) return

    const doc = editor.document
    const lastBlock = doc[doc.length - 1]

    for (const final of newFinals) {
      const block = finalToBlock(final)
      editor.insertBlocks([block], lastBlock, 'after')
    }

    processedCountRef.current = finals.length
  }, [finals, editorRef])
}
