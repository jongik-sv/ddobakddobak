import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useChatStore, emptyScope } from './chatStore'
import * as api from '../api/chat'

describe('chatStore scope', () => {
  beforeEach(() => useChatStore.getState().reset())

  it('load는 scope로 메시지를 가져온다', async () => {
    vi.spyOn(api, 'getScopedChatMessages').mockResolvedValue([
      { id: 1, role: 'user', content: 'q', status: 'complete', created_at: '' } as api.ChatMessage,
    ])
    await useChatStore.getState().load('folder', 7)
    expect(api.getScopedChatMessages).toHaveBeenCalledWith('folder', 7)
    expect(useChatStore.getState().getScope('folder', 7).messages).toHaveLength(1)
  })

  it('send는 scope로 보내고 user + pending assistant를 append한다', async () => {
    vi.spyOn(api, 'sendScopedChatMessage').mockResolvedValue({
      user_message: { id: 1, role: 'user', content: 'q', status: 'complete', created_at: '' } as api.ChatMessage,
      assistant_message: { id: 2, role: 'assistant', content: '', status: 'pending', created_at: '' } as api.ChatMessage,
    })
    await useChatStore.getState().send('folder', 7, 'q')
    expect(api.sendScopedChatMessage).toHaveBeenCalledWith('folder', 7, 'q')
    const msgs = useChatStore.getState().getScope('folder', 7).messages
    expect(msgs.map((m) => m.id)).toEqual([1, 2])
  })

  it('applyUpdate는 id로 assistant 메시지를 교체한다', () => {
    useChatStore.getState().setScope('folder', 7, {
      messages: [{ id: 2, role: 'assistant', content: '', status: 'pending', created_at: '' }],
    })
    useChatStore.getState().applyUpdate('folder', 7, { id: 2, role: 'assistant', content: '답', status: 'complete', created_at: '' })
    expect(useChatStore.getState().getScope('folder', 7).messages[0].content).toBe('답')
    expect(useChatStore.getState().getScope('folder', 7).messages[0].status).toBe('complete')
  })

  it('applyUpdate는 머지하여 update에 없는 필드를 보존한다', () => {
    useChatStore.getState().setScope('folder', 7, {
      messages: [{ id: 2, role: 'assistant', content: '기존답변', status: 'complete', created_at: '2026-06-16' }],
    })
    // 부분 update(예: error broadcast)에 content/created_at이 없어도 지워지면 안 된다
    useChatStore.getState().applyUpdate('folder', 7, { id: 2, status: 'error', error_message: 'boom' } as api.ChatMessage)
    const m = useChatStore.getState().getScope('folder', 7).messages[0]
    expect(m.status).toBe('error')
    expect(m.error_message).toBe('boom')
    expect(m.content).toBe('기존답변')
    expect(m.created_at).toBe('2026-06-16')
  })

  it('applyUpdate는 다른 scope를 건드리지 않는다', () => {
    useChatStore.getState().setScope('folder', 7, {
      messages: [{ id: 2, role: 'assistant', content: '폴더', status: 'complete', created_at: '' }],
    })
    useChatStore.getState().setScope('meeting', 9, {
      messages: [{ id: 2, role: 'assistant', content: '회의', status: 'complete', created_at: '' }],
    })
    useChatStore.getState().applyUpdate('folder', 7, { id: 2, content: '바뀜', status: 'complete', created_at: '' } as api.ChatMessage)
    // meeting scope는 미동
    expect(useChatStore.getState().getScope('meeting', 9).messages[0].content).toBe('회의')
    expect(useChatStore.getState().getScope('folder', 7).messages[0].content).toBe('바뀜')
  })

  it('send/applyUpdate는 서로 다른 scopeKey에 독립적으로 적용된다', async () => {
    vi.spyOn(api, 'sendScopedChatMessage').mockResolvedValue({
      user_message: { id: 10, role: 'user', content: 'x', status: 'complete', created_at: '' } as api.ChatMessage,
      assistant_message: { id: 11, role: 'assistant', content: '', status: 'pending', created_at: '' } as api.ChatMessage,
    })
    await useChatStore.getState().send('folder', 1, 'x')
    await useChatStore.getState().send('project', 1, 'x')
    expect(useChatStore.getState().getScope('folder', 1).messages).toHaveLength(2)
    expect(useChatStore.getState().getScope('project', 1).messages).toHaveLength(2)
  })

  it('스코프별 setter는 서로 간섭하지 않는다', () => {
    useChatStore.getState().setDraft('folder', 7, '폴더드래프트')
    useChatStore.getState().setDraft('meeting', 7, '회의드래프트')
    expect(useChatStore.getState().getScope('folder', 7).draft).toBe('폴더드래프트')
    expect(useChatStore.getState().getScope('meeting', 7).draft).toBe('회의드래프트')
    useChatStore.getState().setScrollTop('folder', 7, 123)
    expect(useChatStore.getState().getScope('folder', 7).scrollTop).toBe(123)
    expect(useChatStore.getState().getScope('meeting', 7).scrollTop).toBe(0)
  })

  it('load는 캐시가 있으면 messages를 새로 받아도 부가 상태를 보존한다', async () => {
    // 기존 캐시 세팅
    useChatStore.getState().setScope('folder', 7, {
      messages: [{ id: 1, role: 'user', content: '캐시', status: 'complete', created_at: '' }],
      draft: '임시저장',
    })
    vi.spyOn(api, 'getScopedChatMessages').mockResolvedValue([
      { id: 1, role: 'user', content: '캐시', status: 'complete', created_at: '' } as api.ChatMessage,
      { id: 2, role: 'assistant', content: '새답', status: 'complete', created_at: '' } as api.ChatMessage,
    ])
    await useChatStore.getState().load('folder', 7)
    const scope = useChatStore.getState().getScope('folder', 7)
    expect(scope.messages.map((m) => m.id)).toEqual([1, 2])
    // 캐시된 draft 보존 — 캐시 우선 로드는 부가 상태를 날리지 않는다.
    expect(scope.draft).toBe('임시저장')
  })

  it('reset은 전체 스코프 맵을 비운다', () => {
    useChatStore.getState().setScope('folder', 7, emptyScope())
    useChatStore.getState().reset()
    expect(useChatStore.getState().scopes).toEqual({})
  })

  it('resetScope는 해당 스코프만 지운다', () => {
    useChatStore.getState().setScope('folder', 7, { draft: 'a' })
    useChatStore.getState().setScope('folder', 8, { draft: 'b' })
    useChatStore.getState().resetScope('folder', 7)
    expect(useChatStore.getState().scopes).toEqual({ 'folder:8': expect.objectContaining({ draft: 'b' }) })
  })
})
