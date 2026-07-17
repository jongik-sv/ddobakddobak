import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AiChatPanel } from './AiChatPanel'

// mutable state ref — hoisted so vi.mock factory can close over it.
// send/load 는 안정적인 mock 으로 둬 호출 검증이 가능하게 한다(매 렌더 새 vi.fn() 금지).
const state = vi.hoisted(() => ({
  messages: [
    { id: 1, role: 'assistant', status: 'complete', content: '확정. ⟦t:60000|s:화자 1⟧', suggestions: [] },
  ] as any[],
  send: vi.fn(),
  load: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('../../stores/chatStore', () => ({
  useChatStore: (sel?: any) => {
    const s = { messages: state.messages, load: state.load, send: state.send, refresh: state.refresh }
    return sel ? sel(s) : s
  },
}))
vi.mock('../../channels/chat', () => ({ subscribeChat: () => () => {} }))

beforeEach(() => {
  state.send.mockClear()
  state.load.mockClear()
  state.refresh.mockClear()
  // reset to default (marker message) so existing onSeek test is unaffected
  state.messages = [
    { id: 1, role: 'assistant', status: 'complete', content: '확정. ⟦t:60000|s:화자 1⟧', suggestions: [] },
  ]
})

describe('AiChatPanel 입력 전송 (IME 조합 가드)', () => {
  it('IME 조합 중 Enter(isComposing)는 전송하지 않고, 조합 종료 후 Enter는 전송한다', () => {
    render(<AiChatPanel scopeId={1} />)
    const input = screen.getByPlaceholderText('회의에 질문하기…')
    fireEvent.change(input, { target: { value: '알려줘' } })

    // 조합 중 Enter → 전송 금지 (잔여 '줘' 이중전송 방지)
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(state.send).not.toHaveBeenCalled()

    // 조합 종료 후 Enter → 정상 전송
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(state.send).toHaveBeenCalledWith('meeting', 1, '알려줘')
  })
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
