import { useState, useEffect } from 'react'
import { Trash2, Pencil, Check, X } from 'lucide-react'
import { useMeetingTemplateStore } from '../../stores/meetingTemplateStore'

export default function MeetingTemplateManager() {
  const { templates, isLoaded, fetch, update, remove } = useMeetingTemplateStore()
  const [editId, setEditId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')

  useEffect(() => { fetch() }, [fetch])

  const startEdit = (id: number, name: string) => {
    setEditId(id)
    setEditName(name)
  }

  const cancelEdit = () => {
    setEditId(null)
    setEditName('')
  }

  const saveEdit = async () => {
    if (!editId || !editName.trim()) return
    await update(editId, { name: editName.trim() })
    cancelEdit()
  }

  const handleDelete = async (id: number) => {
    await remove(id)
  }

  if (!isLoaded) {
    return <p className="text-sm text-muted-foreground">로딩 중...</p>
  }

  if (templates.length === 0) {
    return <p className="text-sm text-muted-foreground">저장된 템플릿이 없습니다. 회의 설정에서 "템플릿으로 저장" 버튼으로 추가할 수 있습니다.</p>
  }

  return (
    <div className="space-y-2">
      {templates.map((t) => (
        <div key={t.id} className="flex items-center gap-2 rounded-md border px-3 py-2">
          {editId === t.id ? (
            <>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit() }}
                className="flex-1 rounded border px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring"
                autoFocus
              />
              <button onClick={saveEdit} className="p-2.5 text-green-600 hover:bg-green-50 rounded">
                <Check className="w-4 h-4" />
              </button>
              <button onClick={cancelEdit} className="p-2.5 text-gray-400 hover:bg-gray-100 rounded">
                <X className="w-4 h-4" />
              </button>
            </>
          ) : (
            <>
              <span className="flex-1 text-sm">{t.name}</span>
              {t.meeting_type && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200">
                  {t.meeting_type}
                </span>
              )}
              <button onClick={() => startEdit(t.id, t.name)} className="p-2.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => handleDelete(t.id)} className="p-2.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      ))}
    </div>
  )
}
