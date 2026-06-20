import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AiChatPanel } from './AiChatPanel'

// mutable state ref — hoisted so vi.mock factory can close over it
const state = vi.hoisted(() => ({
  messages: [
    { id: 1, role: 'assistant', status: 'complete', content: '확정. ⟦t:60000|s:화자 1⟧', suggestions: [] },
  ] as any[],
}))

vi.mock('../../stores/chatStore', () => ({
  useChatStore: (sel?: any) => {
    const s = { messages: state.messages, load: vi.fn(), send: vi.fn() }
    return sel ? sel(s) : s
  },
}))
vi.mock('../../channels/chat', () => ({ subscribeChat: () => () => {} }))

beforeEach(() => {
  // reset to default (marker message) so existing onSeek test is unaffected
  state.messages = [
    { id: 1, role: 'assistant', status: 'complete', content: '확정. ⟦t:60000|s:화자 1⟧', suggestions: [] },
  ]
})

describe('AiChatPanel onSeek', () => {
  it('passes onSeek to badge', () => {
    const onSeek = vi.fn()
    render(<AiChatPanel scopeId={1} onSeek={onSeek} />)
    fireEvent.click(screen.getByText('01:00').closest('button')!)
    expect(onSeek).toHaveBeenCalledWith(60000)
  })
})

describe('AiChatPanel 모델명 헤더 + streaming 렌더', () => {
  it('assistant 헤더에 모델명을 표시한다', () => {
    state.messages = [
      { id: 1, role: 'assistant', content: '답변', status: 'complete', model_name: 'Claude Sonnet 4', created_at: 't', suggestions: [] },
    ]
    render(<AiChatPanel scopeId={1} />)
    expect(screen.getByText('Claude Sonnet 4')).toBeInTheDocument()
  })

  it('streaming 상태는 평문으로 렌더한다(ChatMarkdown 미사용)', () => {
    state.messages = [
      { id: 2, role: 'assistant', content: '부분 답변', status: 'streaming', created_at: 't' },
    ]
    render(<AiChatPanel scopeId={1} />)
    expect(screen.getByText('부분 답변')).toBeInTheDocument()
  })

  it('model_name 없으면 AI 로 표시한다', () => {
    state.messages = [
      { id: 3, role: 'assistant', content: '답변', status: 'complete', created_at: 't', suggestions: [] },
    ]
    render(<AiChatPanel scopeId={1} />)
    expect(screen.getByText('AI')).toBeInTheDocument()
  })
})
