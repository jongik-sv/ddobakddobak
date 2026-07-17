import { create } from 'zustand'
import { getScopedChatMessages, sendScopedChatMessage, type ChatMessage, type ChatScopeType } from '../api/chat'

interface ChatState {
  messages: ChatMessage[]
  loading: boolean
  load: (scopeType: ChatScopeType, scopeId: number) => Promise<void>
  refresh: (scopeType: ChatScopeType, scopeId: number) => Promise<void>
  send: (scopeType: ChatScopeType, scopeId: number, content: string) => Promise<void>
  applyUpdate: (msg: ChatMessage) => void
  reset: () => void
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  loading: false,
  load: async (scopeType, scopeId) => {
    set({ loading: true })
    try {
      set({ messages: await getScopedChatMessages(scopeType, scopeId) })
    } finally {
      set({ loading: false })
    }
  },
  // 폴링 폴백용 조용한 재조회 — 웹소켓 실시간 반영 실패 시 사용.
  // load()와 달리 loading을 건드리지 않아 리스트 깜빡임을 유발하지 않는다.
  refresh: async (scopeType, scopeId) => {
    set({ messages: await getScopedChatMessages(scopeType, scopeId) })
  },
  send: async (scopeType, scopeId, content) => {
    const res = await sendScopedChatMessage(scopeType, scopeId, content)
    set((s) => ({ messages: [...s.messages, res.user_message, res.assistant_message] }))
  },
  applyUpdate: (msg) =>
    set((s) => ({ messages: s.messages.map((m) => (m.id === msg.id ? { ...m, ...msg } : m)) })),
  reset: () => set({ messages: [], loading: false }),
}))
