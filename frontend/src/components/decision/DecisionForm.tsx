import { useState } from 'react'
import type { Decision } from '../../api/decisions'
import {
  createDecision,
  updateDecision,
} from '../../api/decisions'

interface DecisionFormProps {
  meetingId: number
  initialValues?: Partial<Decision>
  onSubmit: (decision: Decision) => void
  onCancel: () => void
}

export function DecisionForm({
  meetingId,
  initialValues,
  onSubmit,
  onCancel,
}: DecisionFormProps) {
  const [content, setContent] = useState(initialValues?.content ?? '')
  const [context, setContext] = useState(initialValues?.context ?? '')
  const [participants, setParticipants] = useState(initialValues?.participants ?? '')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const isEditMode = !!initialValues?.id

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!content.trim()) {
      setError('결정 내용을 입력해주세요')
      return
    }

    setSubmitting(true)
    try {
      let decision: Decision
      if (isEditMode) {
        decision = await updateDecision(initialValues.id!, {
          content: content.trim(),
          context: context.trim() || null,
          participants: participants.trim() || null,
        })
      } else {
        decision = await createDecision(meetingId, {
          content: content.trim(),
          context: context.trim() || null,
          participants: participants.trim() || null,
        })
      }
      onSubmit(decision)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 p-3 bg-gray-50 rounded border">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="결정사항을 입력하세요"
        className="w-full text-sm border rounded p-2 resize-none"
        rows={2}
      />
      {error && <p className="text-xs text-red-500">{error}</p>}

      <input
        type="text"
        value={context}
        onChange={(e) => setContext(e.target.value)}
        placeholder="배경/맥락 (선택)"
        className="w-full text-sm border rounded p-2"
      />

      <input
        type="text"
        value={participants}
        onChange={(e) => setParticipants(e.target.value)}
        placeholder="관련 참여자 (선택)"
        className="w-full text-sm border rounded p-2"
      />

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="text-xs px-3 py-1 rounded border text-gray-600 hover:bg-gray-100"
        >
          취소
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="text-xs px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isEditMode ? '저장' : '추가'}
        </button>
      </div>
    </form>
  )
}
