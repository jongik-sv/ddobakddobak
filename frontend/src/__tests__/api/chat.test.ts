import { describe, it, expect, vi, beforeEach } from 'vitest'

// ky mock — chat.ts는 apiClient(ky 인스턴스)의 get/post(...).json()을 쓴다.
// 실제 client.ts는 ky.create({ prefixUrl: api/v1 base })라 path는 'meetings/...'로 시작한다.
const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('ky', () => {
  const instance = { get, post, patch: vi.fn(), delete: vi.fn() }
  return { default: { create: vi.fn(() => instance) }, __esModule: true }
})

describe('chat API', () => {
  beforeEach(() => {
    get.mockReset()
    post.mockReset()
  })

  it('getChatMessages: 중첩 경로로 GET하고 메시지 배열을 반환한다', async () => {
    const messages = [{ id: 1, role: 'user', content: 'q', status: 'complete', created_at: '' }]
    get.mockReturnValue({ json: () => Promise.resolve(messages) })
    const { getChatMessages } = await import('../../api/chat')

    const result = await getChatMessages(7)

    expect(get).toHaveBeenCalledWith('meetings/7/chat_messages')
    expect(result).toEqual(messages)
  })

  it('sendChatMessage: content를 json으로 POST하고 user/assistant 메시지를 반환한다', async () => {
    const res = {
      user_message: { id: 1, role: 'user', content: '질문?', status: 'complete', created_at: '' },
      assistant_message: { id: 2, role: 'assistant', content: '', status: 'pending', created_at: '' },
    }
    post.mockReturnValue({ json: () => Promise.resolve(res) })
    const { sendChatMessage } = await import('../../api/chat')

    const result = await sendChatMessage(7, '질문?')

    expect(post).toHaveBeenCalledWith('meetings/7/chat_messages', { json: { content: '질문?' } })
    expect(result).toEqual(res)
  })
})
