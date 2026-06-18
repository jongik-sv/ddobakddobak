import { create } from 'zustand'
import { getScopedChatMessages, sendScopedChatMessage, type ChatMessage, type ChatScopeType } from '../api/chat'

interface ChatState {
  messages: ChatMessage[]
  loading: boolean
  load: (scopeType: ChatScopeType, scopeId: number) => Promise<void>
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
  send: async (scopeType, scopeId, content) => {
    const res = await sendScopedChatMessage(scopeType, scopeId, content)
    set((s) => ({ messages: [...s.messages, res.user_message, res.assistant_message] }))
  },
  applyUpdate: (msg) =>
    set((s) => ({ messages: s.messages.map((m) => (m.id === msg.id ? { ...m, ...msg } : m)) })),
  reset: () => set({ messages: [], loading: false }),
}))
