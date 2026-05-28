import type { TermCorrection } from '../../api/meetings'

/** 오타 수정 접기 섹션 (회의 상세 페이지 하단) — 회의록 + 트랜스크립트 일괄 치환 */
export function TermCorrectionDetails({
  corrections,
  status,
  isApplying,
  onUpdate,
  onAdd,
  onRemove,
  onApply,
}: {
  corrections: TermCorrection[]
  status: string
  isApplying: boolean
  onUpdate: (index: number, field: 'from' | 'to', value: string) => void
  onAdd: () => void
  onRemove: (index: number) => void
  onApply: () => void
}) {
  return (
    <div className="border-t bg-white px-6 py-3 shrink-0">
      <details className="group">
        <summary className="cursor-pointer text-sm font-semibold text-gray-500 select-none flex items-center gap-2">
          <span className="transition-transform group-open:rotate-90">&rsaquo;</span>
          오타 수정
          {status && (
            <span className="text-xs font-normal text-blue-500 ml-2">{status}</span>
          )}
        </summary>
        <div className="mt-2 flex flex-col gap-2 max-w-2xl">
          <p className="text-xs text-gray-400">
            잘못된 용어를 올바른 용어로 일괄 치환합니다 (회의록 + 트랜스크립트)
          </p>
          {corrections.map((c, i) => (
            <div key={i} className="flex items-center gap-1">
              <input
                type="text"
                value={c.from}
                onChange={(e) => onUpdate(i, 'from', e.target.value)}
                placeholder="잘못된 용어"
                className="flex-1 min-w-0 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                disabled={isApplying}
              />
              <span className="text-gray-400 text-xs shrink-0">&rarr;</span>
              <input
                type="text"
                value={c.to}
                onChange={(e) => onUpdate(i, 'to', e.target.value)}
                placeholder="올바른 용어"
                className="flex-1 min-w-0 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                disabled={isApplying}
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
          <div className="flex items-center gap-2">
            <button
              onClick={onAdd}
              disabled={isApplying}
              className="text-xs text-blue-500 hover:text-blue-700"
            >
              + 용어 추가
            </button>
            <button
              onClick={onApply}
              disabled={!corrections.some((c) => c.from.trim() && c.to.trim()) || isApplying}
              className="ml-auto px-4 py-1.5 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isApplying ? '반영 중...' : '오타 수정 적용'}
            </button>
          </div>
        </div>
      </details>
    </div>
  )
}
