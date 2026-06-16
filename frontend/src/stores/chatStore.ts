import { create } from 'zustand'
import { getChatMessages, sendChatMessage, type ChatMessage } from '../api/chat'

interface ChatState {
  messages: ChatMessage[]
  loading: boolean
  load: (meetingId: number) => Promise<void>
  send: (meetingId: number, content: string) => Promise<void>
  applyUpdate: (msg: ChatMessage) => void
  reset: () => void
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  loading: false,
  load: async (meetingId) => {
    set({ loading: true })
    try {
      set({ messages: await getChatMessages(meetingId) })
    } finally {
      set({ loading: false })
    }
  },
  send: async (meetingId, content) => {
    const res = await sendChatMessage(meetingId, content)
    set((s) => ({ messages: [...s.messages, res.user_message, res.assistant_message] }))
  },
  applyUpdate: (msg) =>
    set((s) => ({ messages: s.messages.map((m) => (m.id === msg.id ? { ...m, ...msg } : m)) })),
  reset: () => set({ messages: [], loading: false }),
}))
