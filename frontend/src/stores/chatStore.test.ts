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
})
