/** 메모 저장 헤더 바 — 모바일/데스크톱 양쪽에서 재사용 */
export function MemoHeader({
  onSave,
  isSaving,
}: {
  onSave: () => void
  isSaving: boolean
}) {
  return (
    <div className="flex items-center justify-between px-4 py-2 border-b bg-gray-50 shrink-0">
      <h2 className="text-sm font-semibold text-gray-500">메모</h2>
      <button
        onClick={onSave}
        disabled={isSaving}
        className="px-3 py-1 rounded-md text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isSaving ? '저장 중...' : '저장'}
      </button>
    </div>
  )
}
