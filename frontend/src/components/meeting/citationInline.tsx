// frontend/src/components/meeting/citationInline.tsx
import { createReactInlineContentSpec } from '@blocknote/react'
import type { Block, BlockSchema, InlineContentSchema, StyleSchema } from '@blocknote/core'
import { CITATION_RE, FOLDER_CITATION_RE, markerTimeToMs } from '../../lib/citationMarkers'
import { TimestampBadge } from './TimestampBadge'
import { useTranscriptStore } from '../../stores/transcriptStore'

export const CitationInline = createReactInlineContentSpec(
  {
    type: 'citation' as const,
    propSchema: { ms: { default: 0 }, speaker: { default: '' }, meetingId: { default: 0 } },
    content: 'none',
  },
  {
    render: ({ inlineContent }) => {
      const ms = inlineContent.props.ms as number
      const meetingId = Number(inlineContent.props.meetingId) || 0
      const rawSpeaker = inlineContent.props.speaker as string
      let speakerLabel = rawSpeaker
      let speakerName: string | null = null
      if (meetingId <= 0) {
        // 배지 시각으로 현재(화자분리 후) 화자를 해석 — 없으면 마커에 박힌 옛 화자로 폴백.
        // 이전 회의 마커(meetingId>0)는 다른 회의의 전사 기준이라 재해석하면 엉뚱한 화자가
        // 나온다 — 마커에 박힌 화자 문자열을 그대로 쓴다(재해석 금지).
        const resolver = (window as any).__ddobakSpeakerAt
        const actual = resolver ? resolver(ms) : null
        speakerLabel = actual?.speaker_label || rawSpeaker
        speakerName = actual?.speaker_name ?? null
      }
      // eslint-disable-next-line react-hooks/rules-of-hooks -- render는 BlockNote가 실제 React 컴포넌트로
      // 마운트하므로(createReactInlineContentSpec) 훅 사용이 유효하다. store 구독이라 nested
      // AiSummaryFullViewModal(같은 회의를 중첩 마운트)과도 값이 항상 일치 — window 전역과 달리
      // 언마운트 순서에 따른 stale/삭제 경쟁이 없다.
      const citationMeetings = useTranscriptStore((s) => s.citationMeetings)
      // 회의명 미상이면 undefined로 넘긴다 — TimestampBadge가 "이전 회의:" 접두 없이
      // "이전 회의 · 화자 · 시간"으로 폴백해 "이전 회의: 이전 회의" 중복을 피한다.
      const meetingTitle = meetingId > 0 ? citationMeetings[String(meetingId)] : undefined
      return (
        <TimestampBadge
          ms={ms}
          speaker={speakerLabel}
          speakerName={speakerName}
          meetingId={meetingId}
          meetingTitle={meetingTitle}
          onSeek={(window as any).__ddobakSeek ?? (() => {})}
        />
      )
    },
  },
)

type AnyBlock = Block<BlockSchema, InlineContentSchema, StyleSchema>

// 텍스트 노드 하나를 marker 정규식으로 분리해 citation 노드를 끼워 넣는다.
// buildProps가 citation 노드의 props(ms/speaker[/meetingId])를 만든다.
function splitTextByMarker(
  content: any[],
  re: RegExp,
  buildProps: (m: RegExpExecArray) => Record<string, unknown>,
): any[] {
  const rebuilt: any[] = []
  for (const node of content) {
    // '⟦' 없는 노드는 어느 마커 포맷과도 매치될 수 없다 — 빠른 스킵(citation 노드도 여기로 통과).
    if (node?.type !== 'text' || typeof node.text !== 'string' || !node.text.includes('⟦')) {
      rebuilt.push(node)
      continue
    }
    let last = 0
    let matchedAny = false
    const scanRe = new RegExp(re.source, 'g')
    let m: RegExpExecArray | null
    while ((m = scanRe.exec(node.text)) !== null) {
      matchedAny = true
      if (m.index > last) rebuilt.push({ type: 'text', text: node.text.slice(last, m.index), styles: node.styles ?? {} })
      rebuilt.push({ type: 'citation', props: buildProps(m) })
      last = m.index + m[0].length
    }
    if (!matchedAny) {
      rebuilt.push(node)
      continue
    }
    if (last < node.text.length) rebuilt.push({ type: 'text', text: node.text.slice(last), styles: node.styles ?? {} })
  }
  return rebuilt
}

// 인라인 배열 하나에서 텍스트 노드를 마커 기준으로 분리 → citation 노드.
// m:(FOLDER_CITATION_RE) 먼저 분리한 뒤 t:(CITATION_RE)를 분리한다 — 1차 패스가 만든 citation
// 노드는 2차 패스에서 type!=='text'라 그대로 통과하므로(오매칭 없음), 순서를 지키는 것으로 충분하다.
function inlineMarkersToCitations(content: any[]): any[] {
  const afterFolder = splitTextByMarker(content, FOLDER_CITATION_RE, (m) => ({
    meetingId: Number(m[1]),
    ms: markerTimeToMs(m[2]),
    speaker: m[3],
  }))
  return splitTextByMarker(afterFolder, CITATION_RE, (m) => ({
    meetingId: 0,
    ms: markerTimeToMs(m[1]),
    speaker: m[2],
  }))
}

function inlineCitationsToMarkers(content: any[]): any[] {
  return content.map((node: any) => {
    if (node?.type !== 'citation') return node
    const meetingId = Number(node.props.meetingId) || 0
    const text = meetingId > 0
      ? `⟦m:${meetingId}/t:${node.props.ms}/s:${node.props.speaker}⟧`
      : `⟦t:${node.props.ms}/s:${node.props.speaker}⟧`
    return { type: 'text', text, styles: {} }
  })
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
