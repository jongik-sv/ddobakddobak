import type { PartialBlock } from '@blocknote/core'
import type { ApiBlock } from '../api/blocks'

// BlockNote type → API block_type 매핑
const BN_TO_API_TYPE: Record<string, string> = {
  paragraph: 'text',
  bulletListItem: 'bullet_list',
  numberedListItem: 'numbered_list',
  checkListItem: 'checkbox',
  quote: 'quote',
  transcript: 'text', // 커스텀 타입은 text로 저장
}

// API block_type → BlockNote type 매핑
const API_TO_BN_TYPE: Record<string, { type: string; props?: Record<string, unknown> }> = {
  text: { type: 'paragraph' },
  heading1: { type: 'heading', props: { level: 1 } },
  heading2: { type: 'heading', props: { level: 2 } },
  heading3: { type: 'heading', props: { level: 3 } },
  bullet_list: { type: 'bulletListItem' },
  numbered_list: { type: 'numberedListItem' },
  checkbox: { type: 'checkListItem' },
  quote: { type: 'quote' },
}

/**
 * BlockNote block type → API block_type
 */
export function toApiBlockType(bnType: string, props: Record<string, unknown>): string {
  if (bnType === 'heading') {
    const level = props.level as number | undefined
    if (level === 1) return 'heading1'
    if (level === 2) return 'heading2'
    if (level === 3) return 'heading3'
    return 'heading1' // 기본값
  }
  return BN_TO_API_TYPE[bnType] ?? 'text'
}

/**
 * API block_type → BlockNote block type + props
 */
export function fromApiBlockType(apiType: string): { type: string; props?: Record<string, unknown> } {
  return API_TO_BN_TYPE[apiType] ?? { type: 'paragraph' }
}

/**
 * 블록의 인라인 콘텐츠를 평문 문자열로 추출
 */
export function extractTextContent(
  block: { content?: Array<{ type: string; text?: string }> }
): string {
  if (!block.content || !Array.isArray(block.content)) return ''
  return block.content
    .filter((inline) => inline.type === 'text')
    .map((inline) => inline.text ?? '')
    .join('')
}

/**
 * API 블록 배열 → BlockNote initialContent 배열
 */
export function apiBlocksToEditorBlocks(apiBlocks: ApiBlock[]): PartialBlock[] {
  return apiBlocks.map((apiBlock) => {
    const { type, props } = fromApiBlockType(apiBlock.block_type)

    const inlineContent = apiBlock.content
      ? [{ type: 'text', text: apiBlock.content, styles: {} }]
      : []

    const editorBlock: PartialBlock = {
      type: type as PartialBlock['type'],
      props: props ?? {},
    }

    // transcript 타입은 content: 'none'이므로 인라인 콘텐츠를 설정하지 않는다
    if (type !== 'transcript') {
      ;(editorBlock as Record<string, unknown>).content = inlineContent
    }

    return editorBlock
  })
}
