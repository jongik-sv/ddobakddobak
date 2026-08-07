// citationInline.test.ts — 순수 변환 함수 라운드트립(렌더 제외)
import { describe, it, expect } from 'vitest'
import { markersToInline, inlineToMarkers } from './citationInline'

const block = (text: string) => ([{ id: 'b1', type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] }] as any)

describe('citation inline round-trip', () => {
  it('splits a marker into a citation inline and back', () => {
    const withInline = markersToInline(block('확정 ⟦t:60000|s:화자 1⟧'))
    const para = withInline[0]
    expect((para.content as any[]).some((c: any) => c.type === 'citation' && c.props.ms === 60000)).toBe(true)
    const back = inlineToMarkers(withInline)
    const joined = (back[0].content as any[]).map((c: any) => c.type === 'text' ? c.text : `⟦t:${c.props.ms}/s:${c.props.speaker}⟧`).join('')
    expect(joined).toBe('확정 ⟦t:60000/s:화자 1⟧')
  })

  it('handles multiple markers in a single text node', () => {
    const input = block('시작 ⟦t:1000|s:화자 1⟧ 중간 ⟦t:2000|s:화자 2⟧ 끝')
    const withInline = markersToInline(input)
    const para = withInline[0]
    const citations = (para.content as any[]).filter((c: any) => c.type === 'citation')
    expect(citations).toHaveLength(2)
    expect(citations[0].props.ms).toBe(1000)
    expect(citations[0].props.speaker).toBe('화자 1')
    expect(citations[1].props.ms).toBe(2000)
    expect(citations[1].props.speaker).toBe('화자 2')

    const back = inlineToMarkers(withInline)
    const joined = (back[0].content as any[]).map((c: any) => c.type === 'text' ? c.text : `⟦t:${c.props.ms}/s:${c.props.speaker}⟧`).join('')
    expect(joined).toBe('시작 ⟦t:1000/s:화자 1⟧ 중간 ⟦t:2000/s:화자 2⟧ 끝')
  })

  it('mm:ss 마커를 ms로 변환해 citation 노드 생성', () => {
    const withInline = markersToInline(block('확정 ⟦t:30:47/s:화자 1⟧'))
    const para = withInline[0]
    expect((para.content as any[]).some((c: any) => c.type === 'citation' && c.props.ms === 1847000)).toBe(true)
  })

  it('preserves text nodes without markers unchanged', () => {
    const input = block('마커 없는 텍스트')
    const result = markersToInline(input)
    expect(result[0].content).toEqual([{ type: 'text', text: '마커 없는 텍스트', styles: {} }])
  })

  it('handles children recursively', () => {
    const blocks: any = [{
      id: 'p1',
      type: 'paragraph',
      props: {},
      content: [],
      children: [{
        id: 'c1',
        type: 'paragraph',
        props: {},
        content: [{ type: 'text', text: '자식 ⟦t:500|s:화자 1⟧', styles: {} }],
        children: [],
      }],
    }]
    const result = markersToInline(blocks)
    const childContent = result[0].children[0].content as any[]
    expect(childContent.some((c: any) => c.type === 'citation' && c.props.ms === 500)).toBe(true)
  })
})

// m: (연결 회의 인용, ⟦m:<meetingId>/t:<ms>/s:<speaker>⟧) 마커 라운드트립.
// 이 텍스트에는 '⟦t:' 부분문자열이 없다(⟦m: 로 시작, t:는 '/' 뒤) — splitTextByMarker의
// 빠른-스킵 가드가 '⟦t:' 만 보고 판단하면 이 케이스가 전부 통과(no-op)해 버그가 재현된다.
describe('m: (cross-meeting citation) marker round-trip', () => {
  it('splits an m: marker into a citation inline carrying meetingId', () => {
    const withInline = markersToInline(block('확정 ⟦m:5/t:90000/s:화자 1⟧'))
    const citations = (withInline[0].content as any[]).filter((c: any) => c.type === 'citation')
    expect(citations).toHaveLength(1)
    expect(citations[0].props).toEqual({ meetingId: 5, ms: 90000, speaker: '화자 1' })
  })

  it('round-trips through inlineToMarkers back to the exact m: marker (ms form)', () => {
    const withInline = markersToInline(block('확정 ⟦m:5/t:90000/s:화자 1⟧ 계속'))
    const back = inlineToMarkers(withInline)
    const joined = (back[0].content as any[]).map((c: any) => c.text).join('')
    expect(joined).toBe('확정 ⟦m:5/t:90000/s:화자 1⟧ 계속')
  })

  it('m: 마커의 t:/s: 사이 | 구분자(하위호환)도 파싱되고, 역직렬화는 / 정규화 형태로 복원된다', () => {
    // FOLDER_CITATION_RE의 t:값과 s: 사이는 [|/] 라 파이프도 허용 — 파싱 후 역직렬화는
    // inlineCitationsToMarkers가 항상 `/` 로 새로 조립하므로 입력 구분자가 무엇이었든
    // 출력은 `/` 로 정규화된다(t: 전용 마커의 기존 정규화 동작과 동일한 관용구).
    const withInline = markersToInline(block('⟦m:5/t:1234|s:화자⟧'))
    const citations = (withInline[0].content as any[]).filter((c: any) => c.type === 'citation')
    expect(citations).toHaveLength(1)
    expect(citations[0].props).toEqual({ meetingId: 5, ms: 1234, speaker: '화자' })

    const back = inlineToMarkers(withInline)
    const joined = (back[0].content as any[]).map((c: any) => c.text).join('')
    expect(joined).toBe('⟦m:5/t:1234/s:화자⟧')
  })

  it('t: 마커(meetingId 없음)는 역직렬화 시 m: 접두 없이 복원된다', () => {
    const withInline = markersToInline(block('⟦t:1000/s:화자 1⟧'))
    const back = inlineToMarkers(withInline)
    const joined = (back[0].content as any[]).map((c: any) => c.text).join('')
    expect(joined).toBe('⟦t:1000/s:화자 1⟧')
  })

  it('m:과 t: 마커가 한 텍스트 노드에 섞여 있어도 각각 정확히 분리·복원된다', () => {
    const input = block('이전 ⟦m:7/t:5000/s:화자 A⟧ 현재 ⟦t:6000/s:화자 B⟧')
    const withInline = markersToInline(input)
    const citations = (withInline[0].content as any[]).filter((c: any) => c.type === 'citation')
    expect(citations).toHaveLength(2)
    expect(citations[0].props).toEqual({ meetingId: 7, ms: 5000, speaker: '화자 A' })
    expect(citations[1].props).toEqual({ meetingId: 0, ms: 6000, speaker: '화자 B' })

    const back = inlineToMarkers(withInline)
    const joined = (back[0].content as any[]).map((c: any) => c.text).join('')
    expect(joined).toBe('이전 ⟦m:7/t:5000/s:화자 A⟧ 현재 ⟦t:6000/s:화자 B⟧')
  })
})
