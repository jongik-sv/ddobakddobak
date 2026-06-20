// frontend/src/components/meeting/citationInline.tsx
import { createReactInlineContentSpec } from '@blocknote/react'
import type { Block, BlockSchema, InlineContentSchema, StyleSchema } from '@blocknote/core'
import { CITATION_RE, markerTimeToMs } from '../../lib/citationMarkers'
import { TimestampBadge } from './TimestampBadge'

export const CitationInline = createReactInlineContentSpec(
  { type: 'citation' as const, propSchema: { ms: { default: 0 }, speaker: { default: '' } }, content: 'none' },
  {
    render: ({ inlineContent }) => (
      <TimestampBadge
        ms={inlineContent.props.ms as number}
        speaker={inlineContent.props.speaker as string}
        onSeek={(window as any).__ddobakSeek ?? (() => {})}
      />
    ),
  },
)

type AnyBlock = Block<BlockSchema, InlineContentSchema, StyleSchema>

// 인라인 배열 하나에서 텍스트 노드를 마커 기준으로 분리 → citation 노드
function inlineMarkersToCitations(content: any[]): any[] {
  const rebuilt: any[] = []
  for (const node of content) {
    if (node?.type === 'text' && typeof node.text === 'string' && node.text.includes('⟦t:')) {
      let last = 0
      const re = new RegExp(CITATION_RE.source, 'g')
      let m: RegExpExecArray | null
      while ((m = re.exec(node.text)) !== null) {
        if (m.index > last) rebuilt.push({ type: 'text', text: node.text.slice(last, m.index), styles: node.styles ?? {} })
        rebuilt.push({ type: 'citation', props: { ms: markerTimeToMs(m[1]), speaker: m[2] } })
        last = m.index + m[0].length
      }
      if (last < node.text.length) rebuilt.push({ type: 'text', text: node.text.slice(last), styles: node.styles ?? {} })
    } else {
      rebuilt.push(node)
    }
  }
  return rebuilt
}

function inlineCitationsToMarkers(content: any[]): any[] {
  return content.map((node: any) =>
    node?.type === 'citation'
      ? { type: 'text', text: `⟦t:${node.props.ms}/s:${node.props.speaker}⟧`, styles: {} }
      : node,
  )
}

// block.content 에 인라인배열 변환 fn 적용. 배열이면 직접, tableContent 면 셀마다.
// 처리 불가(undefined 등)면 null 반환(호출측이 원본 유지).
function mapBlockContent(content: any, fn: (arr: any[]) => any[]): any | null {
  if (Array.isArray(content)) return fn(content)
  if (content?.type === 'tableContent' && Array.isArray(content.rows)) {
    return {
      ...content,
      rows: content.rows.map((row: any) => ({
        ...row,
        cells: Array.isArray(row.cells)
          ? row.cells.map((cell: any) =>
              Array.isArray(cell)
                ? fn(cell)
                : cell && Array.isArray(cell.content)
                  ? { ...cell, content: fn(cell.content) }
                  : cell,
            )
          : row.cells,
      })),
    }
  }
  return null
}

export function markersToInline(blocks: AnyBlock[]): AnyBlock[] {
  return blocks.map((b) => {
    let next = b
    const newContent = mapBlockContent((b as any).content, inlineMarkersToCitations)
    if (newContent !== null) next = { ...(b as any), content: newContent } as AnyBlock
    if ((next as any).children?.length) next = { ...(next as any), children: markersToInline((next as any).children) }
    return next
  })
}

export function inlineToMarkers(blocks: AnyBlock[]): AnyBlock[] {
  return blocks.map((b) => {
    let next = b
    const newContent = mapBlockContent((b as any).content, inlineCitationsToMarkers)
    if (newContent !== null) next = { ...(b as any), content: newContent } as AnyBlock
    if ((next as any).children?.length) next = { ...(next as any), children: inlineToMarkers((next as any).children) }
    return next
  })
}
