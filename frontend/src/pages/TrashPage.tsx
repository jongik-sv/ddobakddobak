import { useEffect, useState } from 'react'
import {
  listTrash,
  restoreTrashItem,
  purgeTrashItem,
  emptyTrash,
  type TrashItem,
} from '../api/trash'
import { confirmDialog } from '../lib/confirmDialog'

const TYPE_LABEL: Record<string, string> = {
  meeting: '회의',
  folder: '폴더',
  project: '프로젝트',
}

export default function TrashPage() {
  const [items, setItems] = useState<TrashItem[]>([])
  const [loading, setLoading] = useState(true)

  const reload = async () => {
    setLoading(true)
    try {
      setItems(await listTrash())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  const onRestore = async (it: TrashItem) => {
    await restoreTrashItem(it.type, it.id)
    void reload()
  }

  const onPurge = async (it: TrashItem) => {
    if (!(await confirmDialog('영구 삭제하시겠습니까? 되돌릴 수 없습니다.', { title: '영구 삭제', kind: 'warning' }))) return
    await purgeTrashItem(it.type, it.id)
    void reload()
  }

  const onEmpty = async () => {
    if (!(await confirmDialog('휴지통을 비우시겠습니까? 모든 항목이 영구 삭제됩니다.', { title: '휴지통 비우기', kind: 'warning' }))) return
    await emptyTrash()
    void reload()
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">휴지통</h1>
        <button
          onClick={onEmpty}
          className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
        >
          휴지통 비우기
        </button>
      </div>
      {loading ? (
        <p className="text-gray-500">불러오는 중…</p>
      ) : items.length === 0 ? (
        <p className="text-gray-500">휴지통이 비어 있습니다.</p>
      ) : (
        <ul className="divide-y divide-gray-200">
          {items.map((it) => (
            <li
              key={`${it.type}-${it.id}`}
              className="flex items-center justify-between py-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                  {TYPE_LABEL[it.type] ?? it.type}
                </span>
                <span className="truncate text-gray-900">{it.title ?? '(제목 없음)'}</span>
                <span className="shrink-0 text-xs text-gray-400">
                  {new Date(it.deleted_at).toLocaleString()}
                </span>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  onClick={() => onRestore(it)}
                  className="rounded border border-blue-300 px-3 py-1 text-sm text-blue-600 hover:bg-blue-50"
                >
                  복구
                </button>
                <button
                  onClick={() => onPurge(it)}
                  className="rounded border border-red-300 px-3 py-1 text-sm text-red-600 hover:bg-red-50"
                >
                  영구삭제
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
