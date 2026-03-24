import { describe, it, expect } from 'vitest'
import {
  apiBlocksToEditorBlocks,
  toApiBlockType,
  fromApiBlockType,
  extractTextContent,
} from '../blockAdapter'
import type { ApiBlock } from '../../api/blocks'

function makeApiBlock(overrides: Partial<ApiBlock> = {}): ApiBlock {
  return {
    id: 1,
    meeting_id: 10,
    block_type: 'text',
    content: '안녕하세요',
    position: 1.0,
    parent_block_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('toApiBlockType', () => {
  it('paragraph → text', () => {
    expect(toApiBlockType('paragraph', {})).toBe('text')
  })

  it('heading level 1 → heading1', () => {
    expect(toApiBlockType('heading', { level: 1 })).toBe('heading1')
  })

  it('heading level 2 → heading2', () => {
    expect(toApiBlockType('heading', { level: 2 })).toBe('heading2')
  })

  it('heading level 3 → heading3', () => {
    expect(toApiBlockType('heading', { level: 3 })).toBe('heading3')
  })

  it('bulletListItem → bullet_list', () => {
    expect(toApiBlockType('bulletListItem', {})).toBe('bullet_list')
  })

  it('numberedListItem → numbered_list', () => {
    expect(toApiBlockType('numberedListItem', {})).toBe('numbered_list')
  })

  it('checkListItem → checkbox', () => {
    expect(toApiBlockType('checkListItem', {})).toBe('checkbox')
  })

  it('quote → quote', () => {
    expect(toApiBlockType('quote', {})).toBe('quote')
  })

  it('transcript (커스텀 타입) → text', () => {
    expect(toApiBlockType('transcript', {})).toBe('text')
  })

  it('알 수 없는 타입 → text (기본값)', () => {
    expect(toApiBlockType('unknown', {})).toBe('text')
  })
})

describe('fromApiBlockType', () => {
  it('text → paragraph', () => {
    const result = fromApiBlockType('text')
    expect(result.type).toBe('paragraph')
    expect(result.props).toBeUndefined()
  })

  it('heading1 → heading + level 1', () => {
    const result = fromApiBlockType('heading1')
    expect(result.type).toBe('heading')
    expect(result.props).toEqual({ level: 1 })
  })

  it('heading2 → heading + level 2', () => {
    const result = fromApiBlockType('heading2')
    expect(result.type).toBe('heading')
    expect(result.props).toEqual({ level: 2 })
  })

  it('heading3 → heading + level 3', () => {
    const result = fromApiBlockType('heading3')
    expect(result.type).toBe('heading')
    expect(result.props).toEqual({ level: 3 })
  })

  it('bullet_list → bulletListItem', () => {
    expect(fromApiBlockType('bullet_list').type).toBe('bulletListItem')
  })

  it('numbered_list → numberedListItem', () => {
    expect(fromApiBlockType('numbered_list').type).toBe('numberedListItem')
  })

  it('checkbox → checkListItem', () => {
    expect(fromApiBlockType('checkbox').type).toBe('checkListItem')
  })

  it('quote → quote', () => {
    expect(fromApiBlockType('quote').type).toBe('quote')
  })

  it('알 수 없는 API 타입 → paragraph (기본값)', () => {
    expect(fromApiBlockType('unknown_api_type').type).toBe('paragraph')
  })
})

describe('apiBlocksToEditorBlocks', () => {
  it('빈 배열 → 빈 배열', () => {
    expect(apiBlocksToEditorBlocks([])).toEqual([])
  })

  it('text 타입 API 블록 → paragraph 에디터 블록으로 변환', () => {
    const apiBlocks = [makeApiBlock({ block_type: 'text', content: '첫 번째 줄' })]
    const result = apiBlocksToEditorBlocks(apiBlocks)
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('paragraph')
  })

  it('heading1 API 블록 → heading 에디터 블록 (level 1)', () => {
    const apiBlocks = [makeApiBlock({ block_type: 'heading1', content: '제목' })]
    const result = apiBlocksToEditorBlocks(apiBlocks)
    expect(result[0].type).toBe('heading')
    expect((result[0] as { props?: { level?: number } }).props?.level).toBe(1)
  })

  it('여러 블록 변환 시 순서 유지', () => {
    const apiBlocks = [
      makeApiBlock({ id: 1, block_type: 'heading1', content: '제목', position: 1 }),
      makeApiBlock({ id: 2, block_type: 'text', content: '본문', position: 2 }),
      makeApiBlock({ id: 3, block_type: 'bullet_list', content: '항목', position: 3 }),
    ]
    const result = apiBlocksToEditorBlocks(apiBlocks)
    expect(result).toHaveLength(3)
    expect(result[0].type).toBe('heading')
    expect(result[1].type).toBe('paragraph')
    expect(result[2].type).toBe('bulletListItem')
  })

  it('content 문자열이 에디터 블록의 인라인 콘텐츠로 변환됨', () => {
    const apiBlocks = [makeApiBlock({ content: '테스트 내용' })]
    const result = apiBlocksToEditorBlocks(apiBlocks)
    // paragraph 블록은 content 배열을 가진다
    const block = result[0] as { content?: Array<{ text?: string }> }
    expect(block.content).toBeDefined()
    if (Array.isArray(block.content) && block.content.length > 0) {
      expect(block.content[0].text).toBe('테스트 내용')
    }
  })
})

describe('extractTextContent', () => {
  it('빈 content → 빈 문자열', () => {
    const block = { content: [] } as { content: Array<{ type: string; text?: string }> }
    expect(extractTextContent(block)).toBe('')
  })

  it('단일 텍스트 인라인 콘텐츠 추출', () => {
    const block = {
      content: [{ type: 'text', text: '안녕하세요' }],
    } as { content: Array<{ type: string; text?: string }> }
    expect(extractTextContent(block)).toBe('안녕하세요')
  })

  it('여러 인라인 콘텐츠 이어붙이기', () => {
    const block = {
      content: [
        { type: 'text', text: '첫 번째 ' },
        { type: 'text', text: '두 번째' },
      ],
    } as { content: Array<{ type: string; text?: string }> }
    expect(extractTextContent(block)).toBe('첫 번째 두 번째')
  })

  it('content가 undefined이면 빈 문자열 반환', () => {
    const block = {} as { content?: Array<{ type: string; text?: string }> }
    expect(extractTextContent(block)).toBe('')
  })

  it('text 타입이 아닌 인라인 콘텐츠는 무시', () => {
    const block = {
      content: [
        { type: 'link', text: '링크텍스트' },
        { type: 'text', text: '일반텍스트' },
      ],
    } as { content: Array<{ type: string; text?: string }> }
    expect(extractTextContent(block)).toBe('일반텍스트')
  })
})
