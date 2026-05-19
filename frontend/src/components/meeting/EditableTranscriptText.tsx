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

  // contentEditable 요소는 React가 children을 관리하면 사용자 입력이 리렌더로 덮어써진다.
  // 따라서 텍스트는 JSX children이 아니라 ref로만 동기화한다.
  // - 비편집 모드: 외부 content가 바뀔 때마다 DOM textContent를 갱신
  // - 편집 모드 진입: 시작 시점의 content로 DOM 초기화 (그 이후 입력은 DOM이 권위)
  useEffect(() => {
    if (!isEditing && spanRef.current && spanRef.current.textContent !== content) {
      spanRef.current.textContent = content
    }
  }, [content, isEditing])

  // 편집 진입 시 텍스트 select-all + focus
  useEffect(() => {
    if (isEditing && spanRef.current) {
      const el = spanRef.current
      if (el.textContent !== content) el.textContent = content
      el.focus()
      const range = document.createRange()
      range.selectNodeContents(el)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    }
    // content는 의도적으로 deps에서 제외: 편집 시작 시점의 값으로만 초기화.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing])

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
      // 비편집 상태에서 Enter → 편집 진입
      if (!isEditing) {
        if (editable && e.key === 'Enter') {
          e.preventDefault()
          e.stopPropagation()
          prevContentRef.current = content
          setIsEditing(true)
        }
        return
      }
      // 편집 상태에서 Enter → 저장, Esc → 취소
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
    [isEditing, editable, content, save, cancel],
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
      tabIndex={editable ? 0 : -1}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      onPaste={handlePaste}
      className={
        (className ?? '') +
        ' ' +
        (isEditing
          ? 'outline-none border-l-2 border-blue-500 pl-1 bg-blue-50'
          : editable
            ? 'focus:outline focus:outline-1 focus:outline-blue-400 focus:bg-blue-50/40 rounded-sm'
            : '') +
        ' ' +
        (saving ? 'opacity-60' : '')
      }
    />
  )
}
