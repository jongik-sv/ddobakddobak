import { formatElapsedSeconds } from '../../lib/audioUtils'
import { Dialog } from '../ui/Dialog'

/** 북마크 추가 팝오버 — 라벨 입력 + 저장/취소 */
export function BookmarkPopover({
  timestampMs,
  label,
  onLabelChange,
  onSave,
  onClose,
}: {
  timestampMs: number
  label: string
  onLabelChange: (value: string) => void
  onSave: () => void
  onClose: () => void
}) {
  return (
    <Dialog
      onClose={onClose}
      closeOnBackdrop={false}
      closeOnEsc={false}
      className="bg-white rounded-xl shadow-lg p-5 max-w-xs w-full mx-4"
    >
      <h3 className="text-base font-semibold text-gray-900 mb-1">북마크 추가</h3>
      <p className="text-xs text-gray-400 mb-3">
        {formatElapsedSeconds(Math.floor(timestampMs / 1000))} 지점
      </p>
      <input
        type="text"
        value={label}
        onChange={(e) => onLabelChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSave()
          if (e.key === 'Escape') onClose()
        }}
        placeholder="라벨 (선택사항)"
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent mb-3"
        autoFocus
      />
      <div className="flex justify-end gap-2">
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-sm rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200"
        >
          취소
        </button>
        <button
          onClick={onSave}
          className="px-3 py-1.5 text-sm rounded-md bg-amber-500 text-white hover:bg-amber-600"
        >
          추가
        </button>
      </div>
    </Dialog>
  )
}
