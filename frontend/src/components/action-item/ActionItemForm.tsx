import { useState } from 'react'
import type { ActionItem } from '../../api/actionItems'
import {
  createActionItem,
  updateActionItem,
} from '../../api/actionItems'

interface ActionItemFormProps {
  meetingId: number
  teamMembers: { id: number; name: string }[]
  initialValues?: Partial<ActionItem>
  onSubmit: (item: ActionItem) => void
  onCancel: () => void
}

export function ActionItemForm({
  meetingId,
  teamMembers,
  initialValues,
  onSubmit,
  onCancel,
}: ActionItemFormProps) {
  const [content, setContent] = useState(initialValues?.content ?? '')
  const [assigneeId, setAssigneeId] = useState<number | null>(
    initialValues?.assignee?.id ?? null
  )
  const [dueDate, setDueDate] = useState(initialValues?.due_date ?? null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const isEditMode = !!initialValues?.id

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!content.trim()) {
      setError('할 일 내용을 입력해주세요')
      return
    }

    setSubmitting(true)
    try {
      let item: ActionItem
      if (isEditMode) {
        item = await updateActionItem(initialValues.id!, {
          content: content.trim(),
          assignee_id: assigneeId,
          due_date: dueDate,
        })
      } else {
        item = await createActionItem(meetingId, {
          content: content.trim(),
          assignee_id: assigneeId,
          due_date: dueDate,
        })
      }
      onSubmit(item)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 p-3 bg-gray-50 rounded border">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="할 일을 입력하세요"
        className="w-full text-sm border rounded p-2 resize-none"
        rows={2}
      />
      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="flex gap-2">
        <select
          value={assigneeId ?? ''}
          onChange={(e) => setAssigneeId(e.target.value ? Number(e.target.value) : null)}
          className="flex-1 text-sm border rounded p-1"
        >
          <option value="">담당자 없음</option>
          {teamMembers.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-1 text-sm text-gray-600">
          <span className="sr-only">마감일</span>
          <input
            type="date"
            value={dueDate ?? ''}
            onChange={(e) => setDueDate(e.target.value || null)}
            className="text-sm border rounded p-1"
          />
        </label>
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="text-xs px-3 py-1 min-h-[44px] rounded border text-gray-600 hover:bg-gray-100"
        >
          취소
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="text-xs px-3 py-1 min-h-[44px] rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isEditMode ? '저장' : '추가'}
        </button>
      </div>
    </form>
  )
}
