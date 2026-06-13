import { Bookmark, Trash2, Plus } from 'lucide-react'
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

/**
 * 북마크 목록 — 데스크톱/모바일 트랜스크립트 패널 상단에서 재사용.
 * onAdd 미제공 + 비어 있으면 렌더 안 함(추가 불가 맥락 하위호환).
 * onAdd 제공 시(회의 미리보기 등) 비어 있어도 헤더+안내+추가 버튼 표시.
 */
export function BookmarkList({
  bookmarks,
  onSeek,
  onDelete,
  onAdd,
}: {
  bookmarks: BookmarkType[]
  onSeek: (ms: number) => void
  onDelete: (bookmarkId: number) => void
  onAdd?: () => void
}) {
  if (bookmarks.length === 0 && !onAdd) return null

  return (
    <div className="border-b shrink-0 max-h-48 overflow-y-auto">
      <div className="px-3 py-2 bg-amber-50 border-b flex items-center justify-between">
        <h3 className="text-xs font-semibold text-amber-700 flex items-center gap-1">
          <Bookmark className="w-3 h-3" />
          북마크 ({bookmarks.length})
        </h3>
        {onAdd && (
          <button
            onClick={onAdd}
            className="flex items-center gap-0.5 text-xs text-amber-600 hover:text-amber-800 font-medium"
            title="현재 재생 위치에 북마크 추가"
          >
            <Plus className="w-3 h-3" />
            현재 지점 추가
          </button>
        )}
      </div>
      {bookmarks.length === 0 ? (
        <p className="px-3 py-3 text-xs text-gray-400 leading-relaxed">
          아직 북마크가 없습니다. 재생 위치를 옮긴 뒤 <span className="text-amber-600 font-medium">현재 지점 추가</span>를 누르세요.
        </p>
      ) : (
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
      )}
    </div>
  )
}
