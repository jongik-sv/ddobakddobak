import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { Transcript } from '../api/meetings'
import { useTranscriptStore } from '../stores/transcriptStore'
import { findOccurrences } from '../components/meeting/HighlightedText'

export type SearchMatch =
  | { type: 'transcript'; transcriptId: number; occurrence: number }
  | { type: 'summary'; blockId: string; occurrence: number }

const SUMMARY_REGION_SELECTOR = '[data-search-region="summary"]'
const FLASH_CLASS = 'search-block-flash'

function sameMatches(a: SearchMatch[], b: SearchMatch[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (x.type !== y.type || x.occurrence !== y.occurrence) return false
    if (x.type === 'transcript' && y.type === 'transcript' && x.transcriptId !== y.transcriptId) return false
    if (x.type === 'summary' && y.type === 'summary' && x.blockId !== y.blockId) return false
  }
  return true
}

function matchKey(m: SearchMatch | null): string {
  if (!m) return ''
  return m.type === 'transcript'
    ? `t:${m.transcriptId}:${m.occurrence}`
    : `s:${m.blockId}:${m.occurrence}`
}

/**
 * 회의 상세 페이지 내 검색(전사 + AI요약).
 * - 전사: 메모리의 transcripts(+finals 오버라이드)를 occurrence 단위로 매치
 * - 요약: BlockNote 렌더 DOM(.bn-block-content)을 블록 단위로 스캔 (에디터 DOM 비변형)
 */
export function useMeetingSearch(transcripts: Transcript[]) {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [currentIndex, setCurrentIndex] = useState(0)
  /** Ctrl+F 재입력 시 입력창 재포커스 신호 */
  const [focusTick, setFocusTick] = useState(0)
  const [summaryMatches, setSummaryMatches] = useState<SearchMatch[]>([])

  const storeFinals = useTranscriptStore((s) => s.finals)
  const meetingNotes = useTranscriptStore((s) => s.meetingNotes)

  // 입력 응답성 유지: 매치 계산·5000세그먼트 하이라이트 렌더는 deferred 값으로 수행
  const rawQuery = isOpen ? query.trim() : ''
  const effectiveQuery = useDeferredValue(rawQuery)

  // 전사 매치 — finals 오버라이드(EditableTranscriptText 낙관 갱신) 우선
  const transcriptMatches = useMemo<SearchMatch[]>(() => {
    if (!effectiveQuery) return []
    const overrides = new Map<number, string>()
    for (const f of storeFinals) overrides.set(f.id, f.content)
    const matches: SearchMatch[] = []
    for (const t of transcripts) {
      const content = overrides.get(t.id) ?? t.content
      const count = findOccurrences(content, effectiveQuery).length
      for (let i = 0; i < count; i++) {
        matches.push({ type: 'transcript', transcriptId: t.id, occurrence: i })
      }
    }
    return matches
  }, [effectiveQuery, transcripts, storeFinals])

  // 요약 매치 — DOM 스캔. BlockNote는 meetingNotes를 비동기로 렌더(replaceBlocks 후 블록 id
  // 전부 재발급)하므로 단발 스캔은 stale해진다 → MutationObserver로 DOM 변경 시 재스캔.
  useEffect(() => {
    if (!effectiveQuery) {
      setSummaryMatches([])
      return
    }
    const container = document.querySelector(SUMMARY_REGION_SELECTOR)
    if (!container) {
      setSummaryMatches([])
      return
    }
    const scan = () => {
      const matches: SearchMatch[] = []
      // .bn-block-content 단위 스캔 — 중첩 블록(리스트 자식)의 텍스트 이중 카운트 방지
      container.querySelectorAll('.bn-block-content').forEach((blockContent) => {
        const blockId = blockContent.closest('[data-id]')?.getAttribute('data-id')
        if (!blockId) return
        const count = findOccurrences(blockContent.textContent ?? '', effectiveQuery).length
        for (let i = 0; i < count; i++) {
          matches.push({ type: 'summary', blockId, occurrence: i })
        }
      })
      setSummaryMatches((prev) => (sameMatches(prev, matches) ? prev : matches))
    }
    scan()
    // attributes는 관찰하지 않음 — flash 클래스 토글이 무한 재스캔 루프를 만든다
    const observer = new MutationObserver(scan)
    observer.observe(container, { childList: true, characterData: true, subtree: true })
    return () => observer.disconnect()
  }, [effectiveQuery, meetingNotes])

  const matches = useMemo(
    () => [...transcriptMatches, ...summaryMatches],
    [transcriptMatches, summaryMatches]
  )

  // 쿼리/매치 변경 시 인덱스 클램프
  useEffect(() => {
    setCurrentIndex((i) => (matches.length === 0 ? 0 : Math.min(i, matches.length - 1)))
  }, [matches.length])
  useEffect(() => {
    setCurrentIndex(0)
  }, [effectiveQuery])

  const current = matches.length > 0 ? matches[Math.min(currentIndex, matches.length - 1)] : null
  const currentKey = matchKey(current)

  // 현재 매치가 요약 블록이면 scrollIntoView + 일시 강조 (탭 전환 직후를 위해 소지연).
  // 객체 identity가 아닌 논리 키로 발화 — 매치 재계산 churn에 재발화하지 않게.
  useEffect(() => {
    if (!currentKey.startsWith('s:')) return
    const blockId = currentKey.slice(2, currentKey.lastIndexOf(':'))
    const timer = setTimeout(() => {
      const container = document.querySelector(SUMMARY_REGION_SELECTOR)
      const block = container?.querySelector<HTMLElement>(`[data-id="${CSS.escape(blockId)}"]`)
      if (!block) return
      block.scrollIntoView({ behavior: 'smooth', block: 'center' })
      block.classList.remove(FLASH_CLASS)
      // reflow로 애니메이션 재시작
      void block.offsetWidth
      block.classList.add(FLASH_CLASS)
      setTimeout(() => block.classList.remove(FLASH_CLASS), 1300)
    }, 60)
    return () => clearTimeout(timer)
  }, [currentKey])

  const open = useCallback(() => {
    setIsOpen(true)
    setFocusTick((t) => t + 1)
  }, [])

  const close = useCallback(() => {
    setIsOpen(false)
    setQuery('')
    setCurrentIndex(0)
  }, [])

  const next = useCallback(() => {
    setCurrentIndex((i) => (matches.length === 0 ? 0 : (i + 1) % matches.length))
  }, [matches.length])

  const prev = useCallback(() => {
    setCurrentIndex((i) => (matches.length === 0 ? 0 : (i - 1 + matches.length) % matches.length))
  }, [matches.length])

  // Ctrl/Cmd+F 인터셉트 (Tauri 앱 — 네이티브 찾기 없음)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setIsOpen(true)
        setFocusTick((t) => t + 1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return {
    isOpen,
    open,
    close,
    query,
    setQuery,
    /** 트림+deferred 적용된 실제 검색어 (빈 문자열이면 검색 비활성) */
    effectiveQuery,
    matches,
    currentIndex,
    current,
    next,
    prev,
    focusTick,
  }
}
