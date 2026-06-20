// citationInline.test.ts — 순수 변환 함수 라운드트립(렌더 제외)
import { describe, it, expect } from 'vitest'
import { markersToInline, inlineToMarkers } from './citationInline'

const block = (text: string) => ([{ id: 'b1', type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] }] as any)

describe('citation inline round-trip', () => {
  it('splits a marker into a citation inline and back', () => {
    const withInline = markersToInline(block('확정 ⟦t:60000|s:화자 1⟧'))
    const para = withInline[0]
    expect(para.content.some((c: any) => c.type === 'citation' && c.props.ms === 60000)).toBe(true)
    const back = inlineToMarkers(withInline)
    const joined = back[0].content.map((c: any) => c.type === 'text' ? c.text : `⟦t:${c.props.ms}/s:${c.props.speaker}⟧`).join('')
    expect(joined).toBe('확정 ⟦t:60000/s:화자 1⟧')
  })

  it('handles multiple markers in a single text node', () => {
    const input = block('시작 ⟦t:1000|s:화자 1⟧ 중간 ⟦t:2000|s:화자 2⟧ 끝')
    const withInline = markersToInline(input)
    const para = withInline[0]
    const citations = para.content.filter((c: any) => c.type === 'citation')
    expect(citations).toHaveLength(2)
    expect(citations[0].props.ms).toBe(1000)
    expect(citations[0].props.speaker).toBe('화자 1')
    expect(citations[1].props.ms).toBe(2000)
    expect(citations[1].props.speaker).toBe('화자 2')

    const back = inlineToMarkers(withInline)
    const joined = back[0].content.map((c: any) => c.type === 'text' ? c.text : `⟦t:${c.props.ms}/s:${c.props.speaker}⟧`).join('')
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
    const childContent = result[0].children[0].content
    expect(childContent.some((c: any) => c.type === 'citation' && c.props.ms === 500)).toBe(true)
  })
})
