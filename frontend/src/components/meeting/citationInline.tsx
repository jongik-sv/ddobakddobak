// frontend/src/components/meeting/citationInline.tsx
import { createReactInlineContentSpec } from '@blocknote/react'
import type { Block, BlockSchema, InlineContentSchema, StyleSchema } from '@blocknote/core'
import { CITATION_RE } from '../../lib/citationMarkers'
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

export function markersToInline(blocks: AnyBlock[]): AnyBlock[] {
  return blocks.map((b) => {
    const content = Array.isArray((b as any).content) ? (b as any).content : null
    let next = b
    if (content) {
      const rebuilt: any[] = []
      for (const node of content) {
        if (node?.type === 'text' && typeof node.text === 'string' && node.text.includes('⟦t:')) {
          let last = 0
          const re = new RegExp(CITATION_RE.source, 'g')
          let m: RegExpExecArray | null
          while ((m = re.exec(node.text)) !== null) {
            if (m.index > last) rebuilt.push({ type: 'text', text: node.text.slice(last, m.index), styles: node.styles ?? {} })
            rebuilt.push({ type: 'citation', props: { ms: Number(m[1]), speaker: m[2] } })
            last = m.index + m[0].length
          }
          if (last < node.text.length) rebuilt.push({ type: 'text', text: node.text.slice(last), styles: node.styles ?? {} })
        } else {
          rebuilt.push(node)
        }
      }
      next = { ...(b as any), content: rebuilt } as AnyBlock
    }
    if ((next as any).children?.length) next = { ...(next as any), children: markersToInline((next as any).children) }
    return next
  })
}

export function inlineToMarkers(blocks: AnyBlock[]): AnyBlock[] {
  return blocks.map((b) => {
    const content = Array.isArray((b as any).content) ? (b as any).content : null
    let next = b
    if (content) {
      const rebuilt = content.map((node: any) =>
        node?.type === 'citation'
          ? { type: 'text', text: `⟦t:${node.props.ms}|s:${node.props.speaker}⟧`, styles: {} }
          : node,
      )
      next = { ...(b as any), content: rebuilt } as AnyBlock
    }
    if ((next as any).children?.length) next = { ...(next as any), children: inlineToMarkers((next as any).children) }
    return next
  })
}
