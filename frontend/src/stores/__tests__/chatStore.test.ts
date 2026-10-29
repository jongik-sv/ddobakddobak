import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useChatStore, scopeKey, emptyScope } from '../chatStore'
import * as chatApi from '../../api/chat'
import type { ChatMessage } from '../../api/chat'

vi.mock('../../api/chat')

const msg = (over: Partial<ChatMessage>): ChatMessage => ({
  id: 1, role: 'assistant', content: '', status: 'pending', created_at: '', ...over,
})

function seed(messages: ChatMessage[]) {
  useChatStore.setState({ scopes: { [scopeKey('meeting', 7)]: { ...emptyScope(), messages } } })
}
async function refreshWith(server: ChatMessage[]) {
  vi.mocked(chatApi.getScopedChatMessages).mockResolvedValue(server)
  await useChatStore.getState().refresh('meeting', 7)
  return useChatStore.getState().scopes[scopeKey('meeting', 7)].messages
}

describe('chatStore.refresh 병합', () => {
  beforeEach(() => useChatStore.setState({ scopes: {} }))

  it('로컬 streaming 이 서버 pending 에 덮이지 않는다', async () => {
    seed([msg({ status: 'streaming', content: '부분 본문' })])
    const r = await refreshWith([msg({ status: 'pending', content: '' })])
    expect(r[0].status).toBe('streaming')
    expect(r[0].content).toBe('부분 본문')
  })

  it('둘 다 streaming 이면 더 긴 content 를 유지한다', async () => {
    seed([msg({ status: 'streaming', content: '긴 본문입니다' })])
    const r = await refreshWith([msg({ status: 'streaming', content: '짧은' })])
    expect(r[0].content).toBe('긴 본문입니다')
  })

  it('서버 streaming 이 더 길면 서버 값을 쓴다', async () => {
    seed([msg({ status: 'streaming', content: '짧' })])
    const r = await refreshWith([msg({ status: 'streaming', content: '서버가 더 긴 본문' })])
    expect(r[0].content).toBe('서버가 더 긴 본문')
  })

  it('서버 complete 는 로컬 streaming 을 대체한다', async () => {
    seed([msg({ status: 'streaming', content: '부분' })])
    const r = await refreshWith([msg({ status: 'complete', content: '최종' })])
    expect(r[0].status).toBe('complete')
    expect(r[0].content).toBe('최종')
  })

  it('로컬 complete 는 서버 streaming 에 되돌려지지 않는다', async () => {
    seed([msg({ status: 'complete', content: '최종' })])
    const r = await refreshWith([msg({ status: 'streaming', content: '부분' })])
    expect(r[0].status).toBe('complete')
  })

  it('서버에만 있는 새 메시지가 추가되고 순서는 서버를 따른다', async () => {
    seed([msg({ id: 2, status: 'streaming', content: 'x' })])
    const r = await refreshWith([
      msg({ id: 1, role: 'user', status: 'complete', content: 'q' }),
      msg({ id: 2, status: 'pending' }),
      msg({ id: 3, role: 'user', status: 'complete', content: 'q2' }),
    ])
    expect(r.map((m) => m.id)).toEqual([1, 2, 3])
    expect(r[1].status).toBe('streaming')
  })
})
