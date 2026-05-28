import type { ReactNode } from 'react'
import { Globe, Pencil, Trash2 } from 'lucide-react'

interface ServerRowProps {
  selected: boolean
  /** 메인 표시 텍스트 (스캔=URL, 저장=이름/호스트) */
  displayText: string
  /** 메인 텍스트 줄바꿈 방식: 스캔은 break-all, 저장은 truncate */
  displayClassName: string
  /** 보조 텍스트 (이름·위치 / 호스트·포트·위치) */
  sub: string | null
  /** 우측 상태 아이콘 (연결 확인 진행/성공/실패) */
  statusNode: ReactNode
  onPick: () => void
  onEdit: () => void
  /** 저장된 서버에만 삭제 버튼 표시 */
  onDelete?: () => void
  /** 인라인 편집 폼 (열려있을 때만 노드) */
  editForm: ReactNode
}

/** 스캔 서버 줄 + 저장된 서버 줄 공통 행. 선택 표시 + 선택/편집/삭제 + 인라인 편집 폼. */
export function ServerRow({
  selected,
  displayText,
  displayClassName,
  sub,
  statusNode,
  onPick,
  onEdit,
  onDelete,
  editForm,
}: ServerRowProps) {
  return (
    <div
      className={`rounded-lg border transition-all ${
        selected
          ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
          : 'border-slate-200 hover:border-blue-400'
      }`}
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onPick}
          className="flex-1 min-w-0 flex items-center gap-2 px-3 py-2 text-sm text-left rounded-lg active:scale-[0.99] transition-transform"
        >
          <Globe className={`w-4 h-4 shrink-0 ${selected ? 'text-blue-500' : 'text-slate-500'}`} />
          <span className="min-w-0 flex-1">
            <span className={`block ${displayClassName} ${selected ? 'text-blue-700 font-medium' : 'text-slate-700'}`}>{displayText}</span>
            {sub && <span className="block truncate text-xs text-slate-400">{sub}</span>}
          </span>
          {statusNode}
        </button>
        <button
          type="button"
          aria-label="편집"
          onClick={(e) => { e.stopPropagation(); onEdit() }}
          className={`p-2 ${onDelete ? '' : 'mr-1 '}text-slate-400 hover:text-slate-600 active:scale-90 transition-transform`}
        >
          <Pencil className="w-4 h-4" />
        </button>
        {onDelete && (
          <button
            type="button"
            aria-label="삭제"
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            className="p-2 mr-1 text-slate-400 hover:text-red-500 active:scale-90 transition-transform"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
      {editForm}
    </div>
  )
}
