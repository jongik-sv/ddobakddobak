import { useEffect, useState } from 'react'
import type { Decision } from '../../api/decisions'
import {
  getDecisions,
  updateDecision,
  deleteDecision,
} from '../../api/decisions'
import { DecisionForm } from './DecisionForm'

interface DecisionListProps {
  meetingId: number
}

const STATUS_LABELS: Record<Decision['status'], string> = {
  active: '유효',
  revised: '수정됨',
  cancelled: '취소됨',
}

const STATUS_COLORS: Record<Decision['status'], string> = {
  active: 'bg-green-100 text-green-700',
  revised: 'bg-yellow-100 text-yellow-700',
  cancelled: 'bg-gray-100 text-gray-500',
}

export function DecisionList({ meetingId }: DecisionListProps) {
  const [items, setItems] = useState<Decision[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingItem, setEditingItem] = useState<Decision | null>(null)

  useEffect(() => {
    getDecisions(meetingId)
      .then(setItems)
      .finally(() => setLoading(false))
  }, [meetingId])

  async function handleStatusChange(item: Decision, newStatus: Decision['status']) {
    const updated = await updateDecision(item.id, { status: newStatus })
    setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)))
  }

  async function handleDelete(id: number) {
    await deleteDecision(id)
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  function handleFormSubmit(item: Decision) {
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
        <h3 className="text-sm font-semibold text-gray-700">Decision Log</h3>
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
        <DecisionForm
          meetingId={meetingId}
          onSubmit={handleFormSubmit}
          onCancel={handleFormCancel}
        />
      )}

      {items.length === 0 && !showForm ? (
        <p className="text-sm text-gray-400">결정사항이 없습니다</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) =>
            editingItem?.id === item.id ? (
              <li key={item.id}>
                <DecisionForm
                  meetingId={meetingId}
                  initialValues={item}
                  onSubmit={handleFormSubmit}
                  onCancel={handleFormCancel}
                />
              </li>
            ) : (
              <li key={item.id} className="flex flex-col gap-1 text-sm p-2 rounded border bg-white">
                <div className="flex items-start gap-2">
                  <span className={`flex-1 ${item.status === 'cancelled' ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                    {item.content}
                  </span>
                  <span className={`shrink-0 px-1.5 py-0.5 text-xs rounded font-medium ${STATUS_COLORS[item.status]}`}>
                    {STATUS_LABELS[item.status]}
                  </span>
                  {item.ai_generated && (
                    <span className="shrink-0 px-1 py-0.5 text-xs rounded bg-purple-100 text-purple-700 font-medium">
                      AI
                    </span>
                  )}
                </div>
                {item.context && (
                  <p className="text-xs text-gray-500 pl-0.5">{item.context}</p>
                )}
                {item.participants && (
                  <p className="text-xs text-gray-400 pl-0.5">{item.participants}</p>
                )}
                <div className="flex items-center gap-2 mt-1">
                  <select
                    value={item.status}
                    onChange={(e) => handleStatusChange(item, e.target.value as Decision['status'])}
                    className="text-xs border rounded p-0.5 text-gray-600"
                  >
                    <option value="active">유효</option>
                    <option value="revised">수정됨</option>
                    <option value="cancelled">취소됨</option>
                  </select>
                  <button
                    onClick={() => setEditingItem(item)}
                    className="text-xs text-gray-400 hover:text-gray-600 min-h-[44px] flex items-center"
                  >
                    수정
                  </button>
                  <button
                    onClick={() => handleDelete(item.id)}
                    className="text-xs text-red-400 hover:text-red-600 min-h-[44px] flex items-center"
                    aria-label="삭제"
                  >
                    삭제
                  </button>
                </div>
              </li>
            )
          )}
        </ul>
      )}
    </div>
  )
}
