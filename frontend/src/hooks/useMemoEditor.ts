import { useRef, useState, useEffect, useCallback } from 'react'
import type { BlockNoteEditor } from '@blocknote/core'
import type { customSchema } from '../components/editor/MeetingEditor'
import { updateMemo } from '../api/meetings'

type EditorRef = BlockNoteEditor<typeof customSchema.blockSchema>

interface UseMemoEditorReturn {
  memoEditorRef: React.RefObject<EditorRef | null>
  onEditorReady: (editor: EditorRef) => void
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

  // 항상 최신 memo 를 콜백/이펙트에서 참조 (effect 재실행 없이 값만 갱신)
  const memoRef = useRef(memo)
  memoRef.current = memo

  // 이미 로드한 (에디터 인스턴스, meetingId) 쌍. transcribing→completed 로 에디터가
  // 언마운트 후 새 인스턴스로 리마운트되면 인스턴스가 달라져 메모를 다시 로드한다.
  // (meetingId 만으로 가드하면 리마운트된 빈 에디터에 재로드가 안 돼 메모가 사라져 보임)
  const loadedRef = useRef<{ editor: EditorRef | null; meetingId: number | null }>({
    editor: null,
    meetingId: null,
  })

  const loadMemoInto = useCallback(
    async (editor: EditorRef | null) => {
      if (!editor) return
      const md = memoRef.current
      if (!md) return // 메모 없으면 로드 안 함
      // 같은 에디터 인스턴스 + 같은 회의면 재로드 금지(사용자 편집 보존)
      if (loadedRef.current.editor === editor && loadedRef.current.meetingId === meetingId) return
      loadedRef.current = { editor, meetingId }
      const blocks = await editor.tryParseMarkdownToBlocks(md)
      editor.replaceBlocks(editor.document, blocks)
    },
    [meetingId],
  )

  // MeetingEditor 가 (재)마운트되어 에디터 인스턴스가 준비되면 호출 — 그 인스턴스에 메모 로드.
  const onEditorReady = useCallback(
    (editor: EditorRef) => {
      memoEditorRef.current = editor
      loadMemoInto(editor)
    },
    [loadMemoInto],
  )

  // 메모가 (비동기로) 나중에 도착하거나 meetingId 가 바뀌면 현재 에디터에 로드.
  useEffect(() => {
    loadMemoInto(memoEditorRef.current)
  }, [memo, meetingId, loadMemoInto])

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

  return { memoEditorRef, onEditorReady, isSavingMemo, handleSaveMemo }
}
