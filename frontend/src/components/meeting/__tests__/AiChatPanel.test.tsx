import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AiChatPanel } from '../AiChatPanel'
import { useChatStore } from '../../../stores/chatStore'

vi.mock('../../../api/chat')
vi.mock('../../../channels/chat', () => ({ subscribeChat: () => () => {} }))

describe('AiChatPanel', () => {
  beforeEach(() => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn()
    useChatStore.setState({ messages: [], loading: false })
  })

  it('renders existing messages', () => {
    useChatStore.setState({
      messages: [
        { id: 1, role: 'user', content: '질문이요', status: 'complete', created_at: '' },
        { id: 2, role: 'assistant', content: '답변이요', status: 'complete', created_at: '' },
      ],
    })
    render(<AiChatPanel meetingId={7} />)
    expect(screen.getByText('질문이요')).toBeInTheDocument()
    expect(screen.getByText('답변이요')).toBeInTheDocument()
  })

  it('calls send on submit', () => {
    const send = vi.fn().mockResolvedValue(undefined)
    useChatStore.setState({ send } as any)
    render(<AiChatPanel meetingId={7} />)
    fireEvent.change(screen.getByPlaceholderText(/질문/), { target: { value: '뭐 결정됐어?' } })
    fireEvent.click(screen.getByRole('button', { name: '전송' }))
    expect(send).toHaveBeenCalledWith(7, '뭐 결정됐어?')
  })

  it('shows typing indicator for pending assistant', () => {
    useChatStore.setState({
      messages: [{ id: 2, role: 'assistant', content: '', status: 'pending', created_at: '' }],
    })
    render(<AiChatPanel meetingId={7} />)
    expect(screen.getByTestId('chat-typing')).toBeInTheDocument()
  })

  it('renders suggestion chips for a complete assistant message', () => {
    useChatStore.setState({
      messages: [
        {
          id: 2,
          role: 'assistant',
          content: '답변이요',
          status: 'complete',
          created_at: '',
          suggestions: ['다음질문1', '다음질문2', '다음질문3'],
        },
      ],
    })
    render(<AiChatPanel meetingId={7} />)
    expect(screen.getByRole('button', { name: '다음질문1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '다음질문2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '다음질문3' })).toBeInTheDocument()
  })

  it('sends the question immediately when a chip is clicked', () => {
    const send = vi.fn().mockResolvedValue(undefined)
    useChatStore.setState({
      send,
      messages: [
        {
          id: 2,
          role: 'assistant',
          content: '답변이요',
          status: 'complete',
          created_at: '',
          suggestions: ['다음질문1', '다음질문2'],
        },
      ],
    } as any)
    render(<AiChatPanel meetingId={7} />)
    fireEvent.click(screen.getByRole('button', { name: '다음질문2' }))
    expect(send).toHaveBeenCalledWith(7, '다음질문2')
  })

  it('disables chips while an assistant message is pending and does not call send on click', () => {
    const send = vi.fn().mockResolvedValue(undefined)
    useChatStore.setState({
      send,
      messages: [
        {
          id: 2,
          role: 'assistant',
          content: '답변이요',
          status: 'complete',
          created_at: '',
          suggestions: ['다음질문1', '다음질문2'],
        },
        { id: 3, role: 'assistant', content: '', status: 'pending', created_at: '' },
      ],
    } as any)
    render(<AiChatPanel meetingId={7} />)
    const chip = screen.getByRole('button', { name: '다음질문1' })
    expect(chip).toBeDisabled()
    fireEvent.click(chip)
    expect(send).not.toHaveBeenCalled()
  })

  it('renders no chips when suggestions are empty or absent', () => {
    useChatStore.setState({
      messages: [
        { id: 2, role: 'assistant', content: '답변', status: 'complete', created_at: '', suggestions: [] },
        { id: 3, role: 'assistant', content: '답변2', status: 'complete', created_at: '' },
      ],
    })
    render(<AiChatPanel meetingId={7} />)
    expect(screen.queryByTestId('chat-suggestions')).not.toBeInTheDocument()
  })

  it('scrolls to bottom when messages update', () => {
    const scrollIntoView = vi.fn()
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView
    useChatStore.setState({
      messages: [
        { id: 2, role: 'assistant', content: '답변이요', status: 'complete', created_at: '' },
      ],
    })
    render(<AiChatPanel meetingId={7} />)
    expect(scrollIntoView).toHaveBeenCalled()
  })

  it('renders a complete assistant message as formatted markdown, not literal syntax', () => {
    useChatStore.setState({
      messages: [
        { id: 2, role: 'assistant', content: '### H\n\n**b**', status: 'complete', created_at: '' },
      ],
    })
    render(<AiChatPanel meetingId={7} />)
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
    useChatStore.setState({
      messages: [
        { id: 1, role: 'user', content: '**x**', status: 'complete', created_at: '' },
      ],
    })
    render(<AiChatPanel meetingId={7} />)
    expect(screen.getByText('**x**')).toBeInTheDocument()
    expect(screen.queryByText('x')).not.toBeInTheDocument()
  })

  it('does not render chips for a pending assistant message even if suggestions exist', () => {
    useChatStore.setState({
      messages: [
        {
          id: 2,
          role: 'assistant',
          content: '',
          status: 'pending',
          created_at: '',
          suggestions: ['질문'],
        },
      ],
    })
    render(<AiChatPanel meetingId={7} />)
    expect(screen.queryByRole('button', { name: '질문' })).not.toBeInTheDocument()
  })
})
