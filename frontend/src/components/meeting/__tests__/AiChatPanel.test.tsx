import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { AiChatPanel } from '../AiChatPanel'
import { useChatStore, emptyScope, scopeKey } from '../../../stores/chatStore'
import * as chatApi from '../../../api/chat'

vi.mock('../../../api/chat')
vi.mock('../../../channels/chat', () => ({ subscribeChat: () => () => {} }))

// 헬퍼: 스코프 state를 setState 패턴으로 세팅. messages만 받아 나머지는 빈 스코프 default.
function setScopeMessages(scopeType: 'meeting' | 'folder' | 'project', scopeId: number, messages: any[]) {
  useChatStore.setState((s) => ({
    scopes: { ...s.scopes, [scopeKey(scopeType, scopeId)]: { ...emptyScope(), messages } },
  }))
}

describe('AiChatPanel', () => {
  beforeEach(() => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn()
    useChatStore.setState({ scopes: {} })
  })

  it('renders existing messages', () => {
    setScopeMessages('meeting', 7, [
      { id: 1, role: 'user', content: '질문이요', status: 'complete', created_at: '' },
      { id: 2, role: 'assistant', content: '답변이요', status: 'complete', created_at: '' },
    ])
    render(<AiChatPanel scopeId={7} />)
    expect(screen.getByText('질문이요')).toBeInTheDocument()
    expect(screen.getByText('답변이요')).toBeInTheDocument()
  })

  it('calls send on submit', () => {
    const send = vi.fn().mockResolvedValue(undefined)
    useChatStore.setState({ send } as any)
    setScopeMessages('meeting', 7, [])
    render(<AiChatPanel scopeId={7} />)
    fireEvent.change(screen.getByPlaceholderText(/질문/), { target: { value: '뭐 결정됐어?' } })
    fireEvent.click(screen.getByRole('button', { name: '전송' }))
    expect(send).toHaveBeenCalledWith('meeting', 7, '뭐 결정됐어?')
  })

  it('shows typing indicator for pending assistant', () => {
    setScopeMessages('meeting', 7, [
      { id: 2, role: 'assistant', content: '', status: 'pending', created_at: '' },
    ])
    render(<AiChatPanel scopeId={7} />)
    expect(screen.getByTestId('chat-typing')).toBeInTheDocument()
  })

  it('renders suggestion chips for a complete assistant message', () => {
    setScopeMessages('meeting', 7, [
      {
        id: 2,
        role: 'assistant',
        content: '답변이요',
        status: 'complete',
        created_at: '',
        suggestions: ['다음질문1', '다음질문2', '다음질문3'],
      },
    ])
    render(<AiChatPanel scopeId={7} />)
    expect(screen.getByRole('button', { name: '다음질문1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '다음질문2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '다음질문3' })).toBeInTheDocument()
  })

  it('sends the question immediately when a chip is clicked', () => {
    const send = vi.fn().mockResolvedValue(undefined)
    useChatStore.setState({ send } as any)
    setScopeMessages('meeting', 7, [
      {
        id: 2,
        role: 'assistant',
        content: '답변이요',
        status: 'complete',
        created_at: '',
        suggestions: ['다음질문1', '다음질문2'],
      },
    ])
    render(<AiChatPanel scopeId={7} />)
    fireEvent.click(screen.getByRole('button', { name: '다음질문2' }))
    expect(send).toHaveBeenCalledWith('meeting', 7, '다음질문2')
  })

  it('disables chips while an assistant message is pending and does not call send on click', () => {
    const send = vi.fn().mockResolvedValue(undefined)
    useChatStore.setState({ send } as any)
    setScopeMessages('meeting', 7, [
      {
        id: 2,
        role: 'assistant',
        content: '답변이요',
        status: 'complete',
        created_at: '',
        suggestions: ['다음질문1', '다음질문2'],
      },
      { id: 3, role: 'assistant', content: '', status: 'pending', created_at: '' },
    ])
    render(<AiChatPanel scopeId={7} />)
    const chip = screen.getByRole('button', { name: '다음질문1' })
    expect(chip).toBeDisabled()
    fireEvent.click(chip)
    expect(send).not.toHaveBeenCalled()
  })

  it('renders no chips when suggestions are empty or absent', () => {
    setScopeMessages('meeting', 7, [
      { id: 2, role: 'assistant', content: '답변', status: 'complete', created_at: '', suggestions: [] },
      { id: 3, role: 'assistant', content: '답변2', status: 'complete', created_at: '' },
    ])
    render(<AiChatPanel scopeId={7} />)
    expect(screen.queryByTestId('chat-suggestions')).not.toBeInTheDocument()
  })

  it('신규 메시지 추가 시에만 하단으로 스크롤한다 (캐시 없음 케이스)', () => {
    const scrollIntoView = vi.fn()
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView
    // 캐시 없이 마운트 — 첫 effect는 prevLen=0 초기화만
    render(<AiChatPanel scopeId={7} />)
    expect(scrollIntoView).not.toHaveBeenCalled()
    // 신규 메시지 추가 → 하단 스크롤. setState를 act로 감싸 재렌더+이펙트 플러시.
    act(() => {
      setScopeMessages('meeting', 7, [
        { id: 2, role: 'assistant', content: '답변이요', status: 'complete', created_at: '' },
      ])
    })
    expect(scrollIntoView).toHaveBeenCalled()
  })

  it('캐시가 있으면 저장된 scrollTop을 복원하고 하단 스크롤은 하지 않는다', () => {
    const scrollIntoView = vi.fn()
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView
    // 캐시 세팅(scrollTop=200) — 마운트 시 restore 경로 탐
    useChatStore.setState({
      scopes: {
        [scopeKey('meeting', 7)]: {
          ...emptyScope(),
          scrollTop: 200,
          messages: [
            { id: 1, role: 'user', content: '오래된질문', status: 'complete', created_at: '' },
            { id: 2, role: 'assistant', content: '오래된답변', status: 'complete', created_at: '' },
          ],
        },
      },
    })
    render(<AiChatPanel scopeId={7} />)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('renders a complete assistant message as formatted markdown, not literal syntax', () => {
    setScopeMessages('meeting', 7, [
      { id: 2, role: 'assistant', content: '### H\n\n**b**', status: 'complete', created_at: '' },
    ])
    render(<AiChatPanel scopeId={7} />)
    // heading present
    expect(screen.getByRole('heading', { name: 'H' })).toBeInTheDocument()
    // bold text inside <strong>
    const strong = screen.getByText('b')
    expect(strong.tagName).toBe('STRONG')
    // no literal markdown markers
    expect(screen.queryByText('### H')).not.toBeInTheDocument()
    expect(screen.queryByText(/\*\*b\*\*/)).not.toBeInTheDocument()
  })

  it('keeps a user message with markdown syntax literal (plain text)', () => {
    setScopeMessages('meeting', 7, [
      { id: 1, role: 'user', content: '**x**', status: 'complete', created_at: '' },
    ])
    render(<AiChatPanel scopeId={7} />)
    expect(screen.getByText('**x**')).toBeInTheDocument()
    expect(screen.queryByText('x')).not.toBeInTheDocument()
  })

  it('does not render chips for a pending assistant message even if suggestions exist', () => {
    setScopeMessages('meeting', 7, [
      {
        id: 2,
        role: 'assistant',
        content: '',
        status: 'pending',
        created_at: '',
        suggestions: ['질문'],
      },
    ])
    render(<AiChatPanel scopeId={7} />)
    expect(screen.queryByRole('button', { name: '질문' })).not.toBeInTheDocument()
  })
})

describe('AiChatPanel 웹소켓 폴백 폴링', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('pending 상태 동안 3초마다 재조회하고, 완료되면 폴링을 멈춘다', async () => {
    const getScopedChatMessages = vi.mocked(chatApi.getScopedChatMessages)
    getScopedChatMessages.mockResolvedValue([
      { id: 2, role: 'assistant', content: '', status: 'pending', created_at: '' },
    ])
    setScopeMessages('meeting', 7, [
      { id: 2, role: 'assistant', content: '', status: 'pending', created_at: '' },
    ])
    render(<AiChatPanel scopeId={7} />)

    // 마운트 시 load()가 호출한 초기 조회를 먼저 흘려보낸다.
    await vi.advanceTimersByTimeAsync(0)
    getScopedChatMessages.mockClear()

    await vi.advanceTimersByTimeAsync(3000)
    expect(getScopedChatMessages).toHaveBeenCalledWith('meeting', 7)
    expect(getScopedChatMessages).toHaveBeenCalledTimes(1)

    // 답변이 완료로 바뀌면 다음 tick부터는 재조회하지 않는다.
    getScopedChatMessages.mockResolvedValue([
      { id: 2, role: 'assistant', content: '완료', status: 'complete', created_at: '' },
    ])
    await vi.advanceTimersByTimeAsync(3000)
    expect(getScopedChatMessages).toHaveBeenCalledTimes(2)

    getScopedChatMessages.mockClear()
    await vi.advanceTimersByTimeAsync(10000)
    expect(getScopedChatMessages).not.toHaveBeenCalled()
  })

  it('streaming 상태에서도 폴링하며, error가 되면 폴링을 멈춘다', async () => {
    const getScopedChatMessages = vi.mocked(chatApi.getScopedChatMessages)
    getScopedChatMessages.mockResolvedValue([
      { id: 3, role: 'assistant', content: '중간', status: 'streaming', created_at: '' },
    ])
    setScopeMessages('meeting', 7, [
      { id: 3, role: 'assistant', content: '중간', status: 'streaming', created_at: '' },
    ])
    render(<AiChatPanel scopeId={7} />)
    await vi.advanceTimersByTimeAsync(0)
    getScopedChatMessages.mockClear()

    getScopedChatMessages.mockResolvedValue([
      { id: 3, role: 'assistant', content: '', status: 'error', error_message: '실패', created_at: '' },
    ])
    await vi.advanceTimersByTimeAsync(3000)
    expect(getScopedChatMessages).toHaveBeenCalledTimes(1)

    getScopedChatMessages.mockClear()
    await vi.advanceTimersByTimeAsync(10000)
    expect(getScopedChatMessages).not.toHaveBeenCalled()
  })

  it('5분 안전 타임아웃이 지나면 pending이 계속돼도 폴링을 멈춘다', async () => {
    const getScopedChatMessages = vi.mocked(chatApi.getScopedChatMessages)
    getScopedChatMessages.mockResolvedValue([
      { id: 4, role: 'assistant', content: '', status: 'pending', created_at: '' },
    ])
    setScopeMessages('meeting', 7, [
      { id: 4, role: 'assistant', content: '', status: 'pending', created_at: '' },
    ])
    render(<AiChatPanel scopeId={7} />)
    await vi.advanceTimersByTimeAsync(0)
    getScopedChatMessages.mockClear()

    // 5분 경과 — 안전 타임아웃으로 인터벌이 정리되어야 한다.
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    expect(getScopedChatMessages.mock.calls.length).toBeGreaterThan(0)

    getScopedChatMessages.mockClear()
    await vi.advanceTimersByTimeAsync(10000)
    expect(getScopedChatMessages).not.toHaveBeenCalled()
  })

  it('언마운트 시 폴링 인터벌을 정리한다', async () => {
    const getScopedChatMessages = vi.mocked(chatApi.getScopedChatMessages)
    getScopedChatMessages.mockResolvedValue([
      { id: 5, role: 'assistant', content: '', status: 'pending', created_at: '' },
    ])
    setScopeMessages('meeting', 7, [
      { id: 5, role: 'assistant', content: '', status: 'pending', created_at: '' },
    ])
    const { unmount } = render(<AiChatPanel scopeId={7} />)
    await vi.advanceTimersByTimeAsync(0)
    unmount()
    getScopedChatMessages.mockClear()

    await vi.advanceTimersByTimeAsync(10000)
    expect(getScopedChatMessages).not.toHaveBeenCalled()
  })
})
