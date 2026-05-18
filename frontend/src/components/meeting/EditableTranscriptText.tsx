import { useEffect, useRef, useState, useCallback } from 'react'
import type React from 'react'
import { useTranscriptStore } from '../../stores/transcriptStore'
import { updateTranscript } from '../../api/meetings'

interface Props {
  transcriptId: number
  meetingId: number
  content: string
  editable: boolean
  className?: string
}

const MAX_LEN = 5000

export function EditableTranscriptText({
  transcriptId,
  meetingId,
  content,
  editable,
  className,
}: Props) {
  const [isEditing, setIsEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const spanRef = useRef<HTMLSpanElement>(null)
  const prevContentRef = useRef<string>(content)
  const clientId = useTranscriptStore((s) => s.clientId)
  const updateFinal = useTranscriptStore((s) => s.updateFinal)

  // 편집 진입 시 텍스트 select-all + focus
  useEffect(() => {
    if (isEditing && spanRef.current) {
      const el = spanRef.current
      el.focus()
      const range = document.createRange()
      range.selectNodeContents(el)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    }
  }, [isEditing])

  // 외부 content 변경(다른 사용자 broadcast 등)이 들어오면 편집 중이 아닐 때만 반영
  useEffect(() => {
    if (!isEditing && spanRef.current) {
      spanRef.current.textContent = content
    }
  }, [content, isEditing])

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!editable || isEditing) return
      e.stopPropagation()
      prevContentRef.current = content
      setIsEditing(true)
    },
    [editable, isEditing, content],
  )

  const cancel = useCallback(() => {
    if (spanRef.current) spanRef.current.textContent = prevContentRef.current
    setIsEditing(false)
  }, [])

  const save = useCallback(async () => {
    if (!spanRef.current) {
      setIsEditing(false)
      return
    }
    const draft = spanRef.current.textContent ?? ''
    const trimmed = draft.trim()
    if (trimmed.length === 0) {
      cancel()
      return
    }
    if (draft.length > MAX_LEN) {
      cancel()
      return
    }
    if (draft === prevContentRef.current) {
      setIsEditing(false)
      return
    }

    // 낙관적 갱신
    updateFinal(transcriptId, draft)
    setIsEditing(false)
    setSaving(true)
    try {
      await updateTranscript(meetingId, transcriptId, draft, clientId)
    } catch {
      // 롤백
      updateFinal(transcriptId, prevContentRef.current)
    } finally {
      setSaving(false)
    }
  }, [cancel, updateFinal, transcriptId, meetingId, clientId])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLSpanElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void save()
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        cancel()
      }
    },
    [save, cancel],
  )

  const handleBlur = useCallback(() => {
    if (isEditing) void save()
  }, [isEditing, save])

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLSpanElement>) => {
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    document.execCommand('insertText', false, text)
  }, [])

  return (
    <span
      ref={spanRef}
      contentEditable={isEditing}
      suppressContentEditableWarning
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      onPaste={handlePaste}
      className={
        (className ?? '') +
        ' ' +
        (isEditing
          ? 'outline-none border-l-2 border-blue-500 pl-1 bg-blue-50'
          : '') +
        ' ' +
        (saving ? 'opacity-60' : '')
      }
    >
      {content}
    </span>
  )
}
