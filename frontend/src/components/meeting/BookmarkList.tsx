import { useState } from 'react'
import { Bookmark, Trash2, Plus, Pencil, Check, X, ChevronDown, ChevronRight } from 'lucide-react'
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
 * onEdit 제공 시 각 북마크 라벨을 인라인 편집할 수 있다.
 */
export function BookmarkList({
  bookmarks,
  onSeek,
  onDelete,
  onAdd,
  onEdit,
  readOnly = false,
  collapsible = false,
}: {
  bookmarks: BookmarkType[]
  onSeek: (ms: number) => void
  onDelete: (bookmarkId: number) => void
  onAdd?: () => void
  onEdit?: (bookmarkId: number, label: string) => void
  /** 잠긴 회의면 북마크 추가·편집·삭제를 막는다 (탐색·이동은 가능). 기본 false. */
  readOnly?: boolean
  /** 모바일에서 헤더 클릭으로 목록을 접을 수 있게 한다 (기본 펼침). 데스크톱은 미사용. 기본 false. */
  collapsible?: boolean
}) {
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState(true)

  if (bookmarks.length === 0 && !onAdd) return null

  function startEdit(b: BookmarkType) {
    setEditingId(b.id)
    setDraft(b.label ?? '')
  }

  function commitEdit() {
    if (editingId != null) onEdit?.(editingId, draft.trim())
    setEditingId(null)
  }

  function cancelEdit() {
    setEditingId(null)
  }

  return (
    <div className="border-b shrink-0 max-h-48 overflow-y-auto">
      <div
        className={`px-3 py-2 bg-amber-50 border-b flex items-center justify-between${
          collapsible ? ' cursor-pointer hover:bg-amber-100' : ''
        }`}
        onClick={collapsible ? () => setOpen((v) => !v) : undefined}
        {...(collapsible
          ? { role: 'button', 'aria-expanded': open, title: open ? '북마크 접기' : '북마크 펼치기' }
          : {})}
      >
        <h3 className="text-xs font-semibold text-amber-700 flex items-center gap-1">
          {collapsible &&
            (open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />)}
          <Bookmark className="w-3 h-3" />
          북마크 ({bookmarks.length})
        </h3>
        {onAdd && !readOnly && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onAdd()
            }}
            className="flex items-center gap-0.5 text-xs text-amber-600 hover:text-amber-800 font-medium"
            title="현재 재생 위치에 북마크 추가"
          >
            <Plus className="w-3 h-3" />
            현재 지점 추가
          </button>
        )}
      </div>
      {collapsible && !open ? null : bookmarks.length === 0 ? (
        <p className="px-3 py-3 text-xs text-gray-400 leading-relaxed">
          {readOnly ? (
            '북마크가 없습니다.'
          ) : (
            <>
              아직 북마크가 없습니다. 재생 위치를 옮긴 뒤 <span className="text-amber-600 font-medium">현재 지점 추가</span>를 누르세요.
            </>
          )}
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {bookmarks.map((b) => {
            const editing = editingId === b.id
            return (
              <li
                key={b.id}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-amber-50 cursor-pointer group"
                onClick={() => {
                  if (!editing) onSeek(b.timestamp_ms)
                }}
              >
                <span className="text-xs font-mono text-amber-600 shrink-0">
                  {formatMs(b.timestamp_ms)}
                </span>
                {editing ? (
                  <>
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          commitEdit()
                        } else if (e.key === 'Escape') {
                          e.preventDefault()
                          cancelEdit()
                        }
                      }}
                      placeholder="라벨 입력"
                      aria-label="북마크 라벨"
                      className="text-xs flex-1 min-w-0 border border-amber-300 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-amber-400"
                    />
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        commitEdit()
                      }}
                      className="p-0.5 rounded text-amber-600 hover:text-amber-800"
                      title="저장"
                    >
                      <Check className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        cancelEdit()
                      }}
                      className="p-0.5 rounded text-gray-400 hover:text-gray-600"
                      title="취소"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </>
                ) : (
                  <>
                    <span className="text-xs text-gray-700 truncate flex-1">
                      {b.label || '(라벨 없음)'}
                    </span>
                    {onEdit && !readOnly && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          startEdit(b)
                        }}
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-gray-400 hover:text-amber-600 transition-all"
                        title="라벨 편집"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    )}
                    {!readOnly && (
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
                    )}
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
