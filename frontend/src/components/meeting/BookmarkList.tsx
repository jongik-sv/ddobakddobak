import { Bookmark, Trash2 } from 'lucide-react'
import type { Bookmark as BookmarkType } from '../../api/bookmarks'

function formatMs(ms: number) {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  return h > 0
    ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** 북마크 목록 — 데스크톱/모바일 트랜스크립트 패널 상단에서 재사용. 비어 있으면 렌더 안 함. */
export function BookmarkList({
  bookmarks,
  onSeek,
  onDelete,
}: {
  bookmarks: BookmarkType[]
  onSeek: (ms: number) => void
  onDelete: (bookmarkId: number) => void
}) {
  if (bookmarks.length === 0) return null

  return (
    <div className="border-b shrink-0 max-h-48 overflow-y-auto">
      <div className="px-3 py-2 bg-amber-50 border-b">
        <h3 className="text-xs font-semibold text-amber-700 flex items-center gap-1">
          <Bookmark className="w-3 h-3" />
          북마크 ({bookmarks.length})
        </h3>
      </div>
      <ul className="divide-y divide-gray-100">
        {bookmarks.map((b) => (
          <li
            key={b.id}
            className="flex items-center gap-2 px-3 py-1.5 hover:bg-amber-50 cursor-pointer group"
            onClick={() => onSeek(b.timestamp_ms)}
          >
            <span className="text-xs font-mono text-amber-600 shrink-0">
              {formatMs(b.timestamp_ms)}
            </span>
            <span className="text-xs text-gray-700 truncate flex-1">
              {b.label || '(라벨 없음)'}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onDelete(b.id)
              }}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-gray-400 hover:text-red-500 transition-all"
              title="삭제"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
