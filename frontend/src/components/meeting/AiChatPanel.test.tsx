import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AiChatPanel } from './AiChatPanel'
import { useChatStore, emptyScope, scopeKey } from '../../stores/chatStore'
import * as chatApi from '../../api/chat'

// 실제 chatStore를 쓴다 — setDraft가 store를 갱신하면 컴포넌트가 재렌더해
// 입력값이 draft로 돌아와야 전송 검증이 가능하다(모킹 store는 재렌더를 몰아줘 전송이 빈값이 됨).
vi.mock('../../api/chat')
vi.mock('../../channels/chat', () => ({ subscribeChat: () => () => {} }))

const SCOPE_TYPE = 'meeting' as const
const SCOPE_ID = 1

function setMessages(messages: any[]) {
  useChatStore.setState((s) => ({
    scopes: { ...s.scopes, [scopeKey(SCOPE_TYPE, SCOPE_ID)]: { ...emptyScope(), messages } },
  }))
}

beforeEach(() => {
  useChatStore.setState({ scopes: {} })
  vi.mocked(chatApi.getScopedChatMessages).mockResolvedValue([])
  vi.mocked(chatApi.sendScopedChatMessage).mockResolvedValue({
    user_message: { id: 99, role: 'user', content: '', status: 'complete', created_at: '' } as chatApi.ChatMessage,
    assistant_message: { id: 100, role: 'assistant', content: '', status: 'pending', created_at: '' } as chatApi.ChatMessage,
  })
  // 기본 마커 메시지 — onSeek 테스트용
  setMessages([
    { id: 1, role: 'assistant', status: 'complete', content: '확정. ⟦t:60000|s:화자 1⟧', suggestions: [] },
  ])
})

describe('AiChatPanel 입력 전송 (IME 조합 가드)', () => {
  it('IME 조합 중 Enter(isComposing)는 전송하지 않고, 조합 종료 후 Enter는 전송한다', () => {
    render(<AiChatPanel scopeId={SCOPE_ID} />)
    const input = screen.getByPlaceholderText('회의에 질문하기…')
    fireEvent.change(input, { target: { value: '알려줘' } })

    // 조합 중 Enter → 전송 금지 (잔여 '줘' 이중전송 방지)
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(chatApi.sendScopedChatMessage).not.toHaveBeenCalled()

    // 조합 종료 후 Enter → 정상 전송
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(chatApi.sendScopedChatMessage).toHaveBeenCalledWith(SCOPE_TYPE, SCOPE_ID, '알려줘')
  })
})

describe('AiChatPanel onSeek', () => {
  it('passes onSeek to badge', () => {
    const onSeek = vi.fn()
    render(<AiChatPanel scopeId={SCOPE_ID} onSeek={onSeek} />)
    fireEvent.click(screen.getByText('01:00').closest('button')!)
    expect(onSeek).toHaveBeenCalledWith(60000)
  })
})

describe('AiChatPanel 모델명 헤더 + streaming 렌더', () => {
  it('assistant 헤더에 모델명을 표시한다', () => {
    setMessages([
      { id: 1, role: 'assistant', content: '답변', status: 'complete', model_name: 'Claude Sonnet 4', created_at: 't', suggestions: [] },
    ])
    render(<AiChatPanel scopeId={SCOPE_ID} />)
    expect(screen.getByText('Claude Sonnet 4')).toBeInTheDocument()
  })

  it('streaming 상태는 평문으로 렌더한다(ChatMarkdown 미사용)', () => {
    setMessages([
      { id: 2, role: 'assistant', content: '부분 답변', status: 'streaming', created_at: 't' },
    ])
    render(<AiChatPanel scopeId={SCOPE_ID} />)
    expect(screen.getByText('부분 답변')).toBeInTheDocument()
  })

  it('model_name 없으면 AI 로 표시한다', () => {
    setMessages([
      { id: 3, role: 'assistant', content: '답변', status: 'complete', created_at: 't', suggestions: [] },
    ])
    render(<AiChatPanel scopeId={SCOPE_ID} />)
    expect(screen.getByText('AI')).toBeInTheDocument()
  })
})
