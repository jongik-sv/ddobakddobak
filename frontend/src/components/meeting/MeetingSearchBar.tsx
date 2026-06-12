import { useEffect, useRef } from 'react'
import { Search, ChevronUp, ChevronDown, X } from 'lucide-react'

interface MeetingSearchBarProps {
  query: string
  onQueryChange: (q: string) => void
  matchCount: number
  /** 0-based. 매치 없으면 무시됨 */
  currentIndex: number
  onNext: () => void
  onPrev: () => void
  onClose: () => void
  /** 증가 시 입력창 재포커스 (Ctrl+F 재입력) */
  focusTick: number
}

/** 회의 상세 페이지 내 검색 바 (전사+요약). Enter=다음, Shift+Enter=이전, Esc=닫기. */
export function MeetingSearchBar({
  query,
  onQueryChange,
  matchCount,
  currentIndex,
  onNext,
  onPrev,
  onClose,
  focusTick,
}: MeetingSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusTick])

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // 한국어 IME 조합 확정 Enter가 매치 이동으로 새지 않게 가드
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) onPrev()
      else onNext()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  const hasQuery = query.trim().length > 0
  const counterText = hasQuery
    ? matchCount > 0
      ? `${Math.min(currentIndex + 1, matchCount)}/${matchCount}`
      : '0/0'
    : ''

  return (
    <div
      data-testid="meeting-search-bar"
      className="flex items-center gap-1.5 px-3 py-1.5 bg-white border-b shrink-0"
    >
      <Search className="w-4 h-4 text-gray-400 shrink-0" />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="전사·요약 검색"
        className="flex-1 min-w-0 text-sm py-1 outline-none bg-transparent"
      />
      {counterText && (
        <span
          data-testid="search-match-counter"
          className={`text-xs tabular-nums shrink-0 ${matchCount > 0 ? 'text-gray-500' : 'text-red-400'}`}
        >
          {counterText}
        </span>
      )}
      <button
        aria-label="이전 매치"
        onClick={onPrev}
        disabled={matchCount === 0}
        className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 transition-colors"
      >
        <ChevronUp className="w-4 h-4 text-gray-600" />
      </button>
      <button
        aria-label="다음 매치"
        onClick={onNext}
        disabled={matchCount === 0}
        className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 transition-colors"
      >
        <ChevronDown className="w-4 h-4 text-gray-600" />
      </button>
      <button
        aria-label="검색 닫기"
        onClick={onClose}
        className="p-1 rounded hover:bg-gray-100 transition-colors"
      >
        <X className="w-4 h-4 text-gray-600" />
      </button>
    </div>
  )
}
