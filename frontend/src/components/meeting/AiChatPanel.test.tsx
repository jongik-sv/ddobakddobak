import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AiChatPanel } from './AiChatPanel'

// chatStore를 mock: assistant complete 메시지 1개에 마커 포함 content
vi.mock('../../stores/chatStore', () => ({
  useChatStore: (sel?: any) => {
    const state = {
      messages: [{ id: 1, role: 'assistant', status: 'complete', content: '확정. ⟦t:60000|s:화자 1⟧', suggestions: [] }],
      load: vi.fn(), send: vi.fn(),
    }
    return sel ? sel(state) : state
  },
}))
vi.mock('../../channels/chat', () => ({ subscribeChat: () => () => {} }))

describe('AiChatPanel onSeek', () => {
  it('passes onSeek to badge', () => {
    const onSeek = vi.fn()
    render(<AiChatPanel scopeId={1} onSeek={onSeek} />)
    fireEvent.click(screen.getByText('01:00').closest('button')!)
    expect(onSeek).toHaveBeenCalledWith(60000)
  })
})
