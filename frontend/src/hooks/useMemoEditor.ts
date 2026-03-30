import { useRef, useState, useEffect, useCallback } from 'react'
import type { BlockNoteEditor } from '@blocknote/core'
import type { customSchema } from '../components/editor/MeetingEditor'
import { updateMemo } from '../api/meetings'

type EditorRef = BlockNoteEditor<typeof customSchema.blockSchema>

interface UseMemoEditorReturn {
  memoEditorRef: React.RefObject<EditorRef | null>
  isSavingMemo: boolean
  handleSaveMemo: () => Promise<void>
}

export function useMemoEditor(
  meetingId: number,
  memo: string | null | undefined,
  opts?: { onSuccess?: () => void; onError?: () => void }
): UseMemoEditorReturn {
  const memoEditorRef = useRef<EditorRef | null>(null)
  const [isSavingMemo, setIsSavingMemo] = useState(false)
  const loadedForIdRef = useRef<number | null>(null)

  // 메모 로드 — meetingId 변경 시 리셋, 폴링에 cleanup 포함
  useEffect(() => {
    if (!memo || loadedForIdRef.current === meetingId) return
    loadedForIdRef.current = meetingId
    let cancelled = false

    const tryLoad = async () => {
      if (cancelled) return
      const editor = memoEditorRef.current
      if (editor) {
        const blocks = await editor.tryParseMarkdownToBlocks(memo)
        if (!cancelled) editor.replaceBlocks(editor.document, blocks)
      } else {
        setTimeout(tryLoad, 100)
      }
    }
    tryLoad()

    return () => { cancelled = true }
  }, [meetingId, memo])

  const handleSaveMemo = useCallback(async () => {
    const editor = memoEditorRef.current
    if (!editor || isSavingMemo) return
    setIsSavingMemo(true)
    try {
      const markdown = await editor.blocksToMarkdownLossy(editor.document)
      await updateMemo(meetingId, markdown)
      opts?.onSuccess?.()
    } catch {
      opts?.onError?.()
    } finally {
      setIsSavingMemo(false)
    }
  }, [meetingId, isSavingMemo, opts])

  return { memoEditorRef, isSavingMemo, handleSaveMemo }
}
