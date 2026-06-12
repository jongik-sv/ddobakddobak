import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMeetingSearch } from './useMeetingSearch'
import { useTranscriptStore } from '../stores/transcriptStore'
import type { Transcript } from '../api/meetings'

function makeTranscript(id: number, content: string): Transcript {
  return {
    id,
    speaker_label: 'SPEAKER_00',
    content,
    started_at_ms: id * 1000,
    ended_at_ms: id * 1000 + 900,
    sequence_number: id,
  } as Transcript
}

const transcripts = [
  makeTranscript(1, '발사대 점검 결과를 공유했습니다'),
  makeTranscript(2, '다음 주 일정 논의'),
  makeTranscript(3, '발사대 보수 그리고 발사대 교체'),
]

beforeEach(() => {
  useTranscriptStore.getState().reset()
  // jsdom에 scrollIntoView 없음
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  document.body.innerHTML = ''
})

function openWithQuery(result: { current: ReturnType<typeof useMeetingSearch> }, q: string) {
  act(() => result.current.open())
  act(() => result.current.setQuery(q))
}

describe('useMeetingSearch — 전사 매치', () => {
  it('세그먼트 순서대로 occurrence 단위 매치를 만든다', () => {
    const { result } = renderHook(() => useMeetingSearch(transcripts))
    openWithQuery(result, '발사대')

    expect(result.current.matches).toEqual([
      { type: 'transcript', transcriptId: 1, occurrence: 0 },
      { type: 'transcript', transcriptId: 3, occurrence: 0 },
      { type: 'transcript', transcriptId: 3, occurrence: 1 },
    ])
    expect(result.current.current).toEqual({ type: 'transcript', transcriptId: 1, occurrence: 0 })
  })

  it('검색바 닫혀 있으면 매치 없음', () => {
    const { result } = renderHook(() => useMeetingSearch(transcripts))
    act(() => result.current.setQuery('발사대'))
    expect(result.current.matches).toHaveLength(0)
    expect(result.current.effectiveQuery).toBe('')
  })

  it('finals 오버라이드(전사 편집 낙관 갱신)를 반영한다', () => {
    const { result } = renderHook(() => useMeetingSearch(transcripts))
    act(() => {
      useTranscriptStore.getState().loadFinals([
        {
          id: 2,
          content: '발사대 일정 논의',
          speaker_label: 'SPEAKER_00',
          started_at_ms: 2000,
          ended_at_ms: 2900,
          sequence_number: 2,
          applied: true,
        },
      ])
    })
    openWithQuery(result, '발사대')

    const ids = result.current.matches.map((m) => (m.type === 'transcript' ? m.transcriptId : null))
    expect(ids).toContain(2)
  })

  it('next/prev 순환 내비게이션', () => {
    const { result } = renderHook(() => useMeetingSearch(transcripts))
    openWithQuery(result, '발사대')

    act(() => result.current.next())
    expect(result.current.currentIndex).toBe(1)
    act(() => result.current.next())
    expect(result.current.currentIndex).toBe(2)
    act(() => result.current.next())
    expect(result.current.currentIndex).toBe(0) // 순환
    act(() => result.current.prev())
    expect(result.current.currentIndex).toBe(2) // 역순환
  })

  it('쿼리 변경 시 currentIndex 리셋', () => {
    const { result } = renderHook(() => useMeetingSearch(transcripts))
    openWithQuery(result, '발사대')
    act(() => result.current.next())
    expect(result.current.currentIndex).toBe(1)

    act(() => result.current.setQuery('일정'))
    expect(result.current.currentIndex).toBe(0)
  })

  it('close 시 쿼리·상태 초기화', () => {
    const { result } = renderHook(() => useMeetingSearch(transcripts))
    openWithQuery(result, '발사대')
    act(() => result.current.close())
    expect(result.current.isOpen).toBe(false)
    expect(result.current.query).toBe('')
    expect(result.current.matches).toHaveLength(0)
  })
})

describe('useMeetingSearch — 요약(BlockNote DOM) 매치', () => {
  function mountSummaryDom() {
    document.body.innerHTML = `
      <div data-search-region="summary">
        <div data-id="block-a">
          <div class="bn-block-content">발사대 관련 결정 사항</div>
        </div>
        <div data-id="block-b">
          <div class="bn-block-content">리스트 부모</div>
          <div data-id="block-b-child">
            <div class="bn-block-content">발사대 후속 작업</div>
          </div>
        </div>
      </div>
    `
  }

  it('블록 단위로 매치하고 중첩 블록을 이중 카운트하지 않는다', () => {
    mountSummaryDom()
    const { result } = renderHook(() => useMeetingSearch([]))
    openWithQuery(result, '발사대')

    expect(result.current.matches).toEqual([
      { type: 'summary', blockId: 'block-a', occurrence: 0 },
      { type: 'summary', blockId: 'block-b-child', occurrence: 0 },
    ])
  })

  it('전사 매치가 요약 매치보다 앞선다', () => {
    mountSummaryDom()
    const { result } = renderHook(() => useMeetingSearch(transcripts))
    openWithQuery(result, '발사대')

    const types = result.current.matches.map((m) => m.type)
    expect(types).toEqual(['transcript', 'transcript', 'transcript', 'summary', 'summary'])
  })

  it('BlockNote 비동기 렌더 후 DOM 변경을 MutationObserver로 재스캔한다', async () => {
    mountSummaryDom()
    const { result } = renderHook(() => useMeetingSearch([]))
    openWithQuery(result, '발사대')
    expect(result.current.matches).toHaveLength(2)

    // replaceBlocks 시뮬레이션 — 블록 id 전부 재발급 + 내용 변경
    await act(async () => {
      const container = document.querySelector('[data-search-region="summary"]')!
      container.innerHTML = `
        <div data-id="new-1"><div class="bn-block-content">발사대 신규 항목 하나</div></div>
        <div data-id="new-2"><div class="bn-block-content">발사대 신규 항목 둘 발사대</div></div>
      `
      // MutationObserver 콜백은 마이크로태스크 — flush
      await Promise.resolve()
    })

    expect(result.current.matches).toEqual([
      { type: 'summary', blockId: 'new-1', occurrence: 0 },
      { type: 'summary', blockId: 'new-2', occurrence: 0 },
      { type: 'summary', blockId: 'new-2', occurrence: 1 },
    ])
  })
})

describe('useMeetingSearch — Ctrl/Cmd+F', () => {
  it('Ctrl+F로 열린다', () => {
    const { result } = renderHook(() => useMeetingSearch(transcripts))
    expect(result.current.isOpen).toBe(false)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true }))
    })
    expect(result.current.isOpen).toBe(true)
  })
})
