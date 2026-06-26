import { useEffect, useRef } from 'react'

/** text 안에서 query의 모든 occurrence 시작 인덱스 (case-insensitive, 비중첩). */
export function findOccurrences(text: string, query: string): number[] {
  if (!query) return []
  const haystack = text.toLowerCase()
  const needle = query.toLowerCase()
  const result: number[] = []
  let from = 0
  while (true) {
    const idx = haystack.indexOf(needle, from)
    if (idx === -1) break
    result.push(idx)
    from = idx + needle.length
  }
  return result
}

interface HighlightedTextProps {
  text: string
  query: string
  /** 이 텍스트 내 활성 occurrence 인덱스. -1이면 없음. */
  activeOccurrence: number
  className?: string
}

/** 검색어 occurrence를 <mark>로 강조해 렌더. 활성 매치는 별색 + 스크롤. */
export function HighlightedText({ text, query, activeOccurrence, className }: HighlightedTextProps) {
  const activeRef = useRef<HTMLElement | null>(null)
  const occurrences = findOccurrences(text, query)

  useEffect(() => {
    if (activeOccurrence >= 0 && activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [activeOccurrence, query, text])

  if (occurrences.length === 0) {
    return <span className={className}>{text}</span>
  }

  const parts: React.ReactNode[] = []
  let cursor = 0
  occurrences.forEach((start, i) => {
    if (start > cursor) parts.push(text.slice(cursor, start))
    const isActive = i === activeOccurrence
    parts.push(
      <mark
        key={i}
        ref={isActive ? (el) => { activeRef.current = el } : undefined}
        data-active={isActive ? 'true' : undefined}
        className={`rounded-sm ${isActive ? 'bg-orange-300 text-foreground' : 'bg-yellow-200 text-foreground'}`}
      >
        {text.slice(start, start + query.length)}
      </mark>
    )
    cursor = start + query.length
  })
  if (cursor < text.length) parts.push(text.slice(cursor))

  return <span className={className}>{parts}</span>
}
