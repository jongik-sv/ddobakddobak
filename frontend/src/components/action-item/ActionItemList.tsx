import { useEffect, useState } from 'react'
import type { ActionItem } from '../../api/actionItems'
import {
  getActionItems,
  updateActionItem,
  deleteActionItem,
} from '../../api/actionItems'
import { ActionItemForm } from './ActionItemForm'

interface ActionItemListProps {
  meetingId: number
  teamMembers: { id: number; name: string }[]
}

export function ActionItemList({ meetingId, teamMembers }: ActionItemListProps) {
  const [items, setItems] = useState<ActionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingItem, setEditingItem] = useState<ActionItem | null>(null)

  useEffect(() => {
    getActionItems(meetingId)
      .then(setItems)
      .finally(() => setLoading(false))
  }, [meetingId])

  async function handleToggle(item: ActionItem) {
    const newStatus = item.status === 'done' ? 'todo' : 'done'
    const updated = await updateActionItem(item.id, { status: newStatus })
    setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)))
  }

  async function handleDelete(id: number) {
    await deleteActionItem(id)
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  function handleFormSubmit(item: ActionItem) {
    if (editingItem) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? item : i)))
      setEditingItem(null)
    } else {
      setItems((prev) => [...prev, item])
      setShowForm(false)
    }
  }

  function handleFormCancel() {
    setShowForm(false)
    setEditingItem(null)
  }

  if (loading) {
    return <div className="p-4 text-sm text-gray-400">로딩 중...</div>
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">Action Items</h3>
        {!showForm && !editingItem && (
          <button
            onClick={() => setShowForm(true)}
            className="text-xs text-blue-600 hover:text-blue-800 min-h-[44px] flex items-center"
          >
            + 추가
          </button>
        )}
      </div>

      {(showForm && !editingItem) && (
        <ActionItemForm
          meetingId={meetingId}
          teamMembers={teamMembers}
          onSubmit={handleFormSubmit}
          onCancel={handleFormCancel}
        />
      )}

      {items.length === 0 && !showForm ? (
        <p className="text-sm text-gray-400">Action Item이 없습니다</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) =>
            editingItem?.id === item.id ? (
              <li key={item.id}>
                <ActionItemForm
                  meetingId={meetingId}
                  teamMembers={teamMembers}
                  initialValues={item}
                  onSubmit={handleFormSubmit}
                  onCancel={handleFormCancel}
                />
              </li>
            ) : (
              <li key={item.id} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={item.status === 'done'}
                  onChange={() => handleToggle(item)}
                  className="mt-0.5 shrink-0"
                />
                <span className={`flex-1 ${item.status === 'done' ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                  {item.content}
                </span>
                {item.ai_generated && (
                  <span className="shrink-0 px-1 py-0.5 text-xs rounded bg-purple-100 text-purple-700 font-medium">
                    AI
                  </span>
                )}
                {item.assignee && (
                  <span className="shrink-0 text-xs text-gray-500">{item.assignee.name}</span>
                )}
                <button
                  onClick={() => setEditingItem(item)}
                  className="shrink-0 text-xs text-gray-400 hover:text-gray-600"
                >
                  수정
                </button>
                <button
                  onClick={() => handleDelete(item.id)}
                  className="shrink-0 text-xs text-red-400 hover:text-red-600"
                  aria-label="삭제"
                >
                  삭제
                </button>
              </li>
            )
          )}
        </ul>
      )}
    </div>
  )
}
