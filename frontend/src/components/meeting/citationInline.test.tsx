// frontend/src/components/meeting/citationInline.test.tsx
import { describe, it, expect } from 'vitest'
import { markersToInline, inlineToMarkers } from './citationInline'

describe('citationInline — 문단 블록', () => {
  it('문단 회귀: 마커 텍스트 → citation 노드', () => {
    const blocks = [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: '결정 보류 ⟦t:125000|s:화자 1⟧', styles: {} }],
      },
    ] as any

    const result = markersToInline(blocks)
    const content: any[] = result[0].content
    const citationNode = content.find((n: any) => n.type === 'citation')
    expect(citationNode).toBeDefined()
    expect(citationNode.props.ms).toBe(125000)
    expect(citationNode.props.speaker).toBe('화자 1')
  })
})

describe('citationInline — 표 블록', () => {
  const tableBlock = {
    type: 'table',
    content: {
      type: 'tableContent',
      rows: [
        {
          cells: [
            { type: 'tableCell', content: [{ type: 'text', text: '입고는 배차량 기준', styles: {} }], props: {} },
            { type: 'tableCell', content: [{ type: 'text', text: '⟦t:420000|s:홍춘식 부장⟧', styles: {} }], props: {} },
          ],
        },
      ],
    },
  }

  it('TableCell 객체형: 마커 텍스트 → citation 노드 (ms:420000, speaker:홍춘식 부장)', () => {
    const result = markersToInline([tableBlock] as any)
    const rows = result[0].content.rows
    const secondCellContent = rows[0].cells[1].content
    const citationNode = secondCellContent.find((n: any) => n.type === 'citation')
    expect(citationNode).toBeDefined()
    expect(citationNode.props.ms).toBe(420000)
    expect(citationNode.props.speaker).toBe('홍춘식 부장')
  })

  it('InlineContent[][] 배열형: 마커 텍스트 → citation 노드', () => {
    const arrayStyleTable = {
      type: 'table',
      content: {
        type: 'tableContent',
        rows: [
          {
            cells: [
              [{ type: 'text', text: '근거 ⟦t:420000|s:홍춘식 부장⟧', styles: {} }],
            ],
          },
        ],
      },
    } as any

    const result = markersToInline([arrayStyleTable])
    const rows = result[0].content.rows
    const firstCellContent = rows[0].cells[0]
    const citationNode = firstCellContent.find((n: any) => n.type === 'citation')
    expect(citationNode).toBeDefined()
    expect(citationNode.props.ms).toBe(420000)
    expect(citationNode.props.speaker).toBe('홍춘식 부장')
  })

  it('라운드트립: 표 블록 inlineToMarkers(markersToInline(blocks)) → 셀 텍스트 복원 (/ 구분자)', () => {
    const result = inlineToMarkers(markersToInline([tableBlock] as any))
    const rows = result[0].content.rows
    const secondCellContent = rows[0].cells[1].content
    const textNode = secondCellContent.find((n: any) => n.type === 'text')
    expect(textNode).toBeDefined()
    expect(textNode.text).toBe('⟦t:420000/s:홍춘식 부장⟧')
  })

  it('markersToInline: | 구분자 입력도 citation 노드로 변환 (하위호환)', () => {
    const pipeBlock = {
      type: 'paragraph',
      content: [{ type: 'text', text: '근거 ⟦t:420000|s:홍춘식 부장⟧', styles: {} }],
    } as any
    const result = markersToInline([pipeBlock])
    const citationNode = result[0].content.find((n: any) => n.type === 'citation')
    expect(citationNode).toBeDefined()
    expect(citationNode.props.ms).toBe(420000)
    expect(citationNode.props.speaker).toBe('홍춘식 부장')
  })

  it('markersToInline: / 구분자 입력도 citation 노드로 변환', () => {
    const slashBlock = {
      type: 'paragraph',
      content: [{ type: 'text', text: '근거 ⟦t:420000/s:홍춘식 부장⟧', styles: {} }],
    } as any
    const result = markersToInline([slashBlock])
    const citationNode = result[0].content.find((n: any) => n.type === 'citation')
    expect(citationNode).toBeDefined()
    expect(citationNode.props.ms).toBe(420000)
    expect(citationNode.props.speaker).toBe('홍춘식 부장')
  })
})
