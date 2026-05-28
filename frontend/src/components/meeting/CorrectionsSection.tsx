import type { TermCorrection } from '../../api/meetings'

/** 오타 수정 섹션 — 모바일/데스크톱 양쪽에서 재사용 */
export function CorrectionsSection({
  corrections,
  isApplyingCorrections,
  onUpdate,
  onAdd,
  onRemove,
  onApply,
}: {
  corrections: TermCorrection[]
  isApplyingCorrections: boolean
  onUpdate: (index: number, field: 'from' | 'to', value: string) => void
  onAdd: () => void
  onRemove: (index: number) => void
  onApply: () => void
}) {
  return (
    <>
      <h2 className="px-4 py-2 text-sm font-semibold text-gray-500 border-b bg-gray-50 shrink-0">
        오타 수정
      </h2>
      <div className="flex-1 flex flex-col p-3 gap-2 overflow-auto">
        <p className="text-xs text-gray-400 shrink-0">
          잘못된 용어를 올바른 용어로 일괄 치환합니다
        </p>
        {corrections.map((c, i) => (
          <div key={i} className="flex items-center gap-1 shrink-0">
            <input
              type="text"
              value={c.from}
              onChange={(e) => onUpdate(i, 'from', e.target.value)}
              placeholder="잘못된 용어"
              className="flex-1 min-w-0 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
              disabled={isApplyingCorrections}
            />
            <span className="text-gray-400 text-xs shrink-0">&rarr;</span>
            <input
              type="text"
              value={c.to}
              onChange={(e) => onUpdate(i, 'to', e.target.value)}
              placeholder="올바른 용어"
              className="flex-1 min-w-0 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
              disabled={isApplyingCorrections}
            />
            <button
              onClick={() => onRemove(i)}
              className="shrink-0 w-6 h-6 flex items-center justify-center text-gray-400 hover:text-red-500 text-sm"
              title="삭제"
            >
              &times;
            </button>
          </div>
        ))}
        <button
          onClick={onAdd}
          disabled={isApplyingCorrections}
          className="shrink-0 text-xs text-blue-500 hover:text-blue-700 self-start"
        >
          + 용어 추가
        </button>
        <button
          onClick={onApply}
          disabled={!corrections.some((c) => c.from.trim() && c.to.trim()) || isApplyingCorrections}
          className="shrink-0 px-4 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isApplyingCorrections ? '반영 중...' : '오타 수정 적용'}
        </button>
      </div>
    </>
  )
}
