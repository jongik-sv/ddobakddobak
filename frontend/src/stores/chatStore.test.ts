import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useChatStore } from './chatStore'
import * as api from '../api/chat'

describe('chatStore scope', () => {
  beforeEach(() => useChatStore.getState().reset())

  it('load는 scope로 메시지를 가져온다', async () => {
    vi.spyOn(api, 'getScopedChatMessages').mockResolvedValue([
      { id: 1, role: 'user', content: 'q', status: 'complete', created_at: '' } as api.ChatMessage,
    ])
    await useChatStore.getState().load('folder', 7)
    expect(api.getScopedChatMessages).toHaveBeenCalledWith('folder', 7)
    expect(useChatStore.getState().messages).toHaveLength(1)
  })

  it('send는 scope로 보내고 user + pending assistant를 append한다', async () => {
    vi.spyOn(api, 'sendScopedChatMessage').mockResolvedValue({
      user_message: { id: 1, role: 'user', content: 'q', status: 'complete', created_at: '' } as api.ChatMessage,
      assistant_message: { id: 2, role: 'assistant', content: '', status: 'pending', created_at: '' } as api.ChatMessage,
    })
    await useChatStore.getState().send('folder', 7, 'q')
    expect(api.sendScopedChatMessage).toHaveBeenCalledWith('folder', 7, 'q')
    const msgs = useChatStore.getState().messages
    expect(msgs.map((m) => m.id)).toEqual([1, 2])
  })

  it('applyUpdate는 id로 assistant 메시지를 교체한다', () => {
    useChatStore.setState({
      messages: [{ id: 2, role: 'assistant', content: '', status: 'pending', created_at: '' }],
    })
    useChatStore.getState().applyUpdate({ id: 2, role: 'assistant', content: '답', status: 'complete', created_at: '' })
    expect(useChatStore.getState().messages[0].content).toBe('답')
    expect(useChatStore.getState().messages[0].status).toBe('complete')
  })

  it('applyUpdate는 머지하여 update에 없는 필드를 보존한다', () => {
    useChatStore.setState({
      messages: [{ id: 2, role: 'assistant', content: '기존답변', status: 'complete', created_at: '2026-06-16' }],
    })
    // 부분 update(예: error broadcast)에 content/created_at이 없어도 지워지면 안 된다
    useChatStore.getState().applyUpdate({ id: 2, status: 'error', error_message: 'boom' } as api.ChatMessage)
    const m = useChatStore.getState().messages[0]
    expect(m.status).toBe('error')
    expect(m.error_message).toBe('boom')
    expect(m.content).toBe('기존답변')
    expect(m.created_at).toBe('2026-06-16')
  })
})
