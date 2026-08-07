// frontend/src/components/meeting/citationInline.test.tsx
import { describe, it, expect } from 'vitest'
import { BlockNoteEditor } from '@blocknote/core'
import { markersToInline, inlineToMarkers } from './citationInline'
import { editorSchema } from './mermaidBlock'

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

  it('m: 마커도 표 셀 안에서 meetingId를 보존해 citation 노드로 변환·복원된다', () => {
    const mBlock = {
      type: 'table',
      content: {
        type: 'tableContent',
        rows: [{ cells: [{ type: 'tableCell', content: [{ type: 'text', text: '⟦m:9/t:420000/s:홍춘식 부장⟧', styles: {} }], props: {} }] }],
      },
    } as any
    const withInline = markersToInline([mBlock])
    const cellContent = withInline[0].content.rows[0].cells[0].content
    const citationNode = cellContent.find((n: any) => n.type === 'citation')
    expect(citationNode.props).toEqual({ meetingId: 9, ms: 420000, speaker: '홍춘식 부장' })

    const back = inlineToMarkers(withInline)
    const textNode = back[0].content.rows[0].cells[0].content.find((n: any) => n.type === 'text')
    expect(textNode.text).toBe('⟦m:9/t:420000/s:홍춘식 부장⟧')
  })
})

// citationInline.test.ts/여기 위 테스트들은 순수 배열 변환만 검증해 BlockNote를 완전히 우회한다 —
// propSchema에서 meetingId를 빼도 통과한다. 아래는 실제 BlockNoteEditor(헤드리스, DOM 없이
// 생성 가능 — @blocknote/core 서버사이드 마크다운 변환에도 쓰이는 API)로 문서를 왕복시켜,
// meetingId가 BlockNote 문서 모델(propSchema)을 실제로 통과해 저장·복원되는지 검증한다.
// 이게 AiSummaryPanel.saveNow()가 쓰는 실제 경로(replaceBlocks → editor.document → inlineToMarkers)다.
describe('citationInline — 실제 BlockNoteEditor를 통한 propSchema 왕복', () => {
  it('meetingId가 editor.replaceBlocks/editor.document를 통과해 보존된다', () => {
    const editor = BlockNoteEditor.create({ schema: editorSchema })
    const blocks: any = [{ type: 'paragraph', content: [{ type: 'text', text: '이전 ⟦m:5/t:90000/s:화자 1⟧', styles: {} }] }]
    editor.replaceBlocks(editor.document, markersToInline(blocks))

    const citationNode = (editor.document[0] as any).content.find((n: any) => n.type === 'citation')
    expect(citationNode.props).toEqual({ ms: 90000, speaker: '화자 1', meetingId: 5 })

    const back = inlineToMarkers(editor.document as any)
    const joined = (back[0] as any).content.map((n: any) => n.text).join('')
    expect(joined).toBe('이전 ⟦m:5/t:90000/s:화자 1⟧')
  })
})
