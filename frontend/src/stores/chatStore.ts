import { create } from 'zustand'
import { getScopedChatMessages, sendScopedChatMessage, type ChatMessage, type ChatScopeType } from '../api/chat'

/**
 * 스코프별 챗 상태. scopeKey = `${scopeType}:${scopeId}`.
 * 폴더/프로젝트 챗(FolderChatDrawer)은 App.tsx 글로벌 영역에 단일 마운트되어
 * 라우트 전환에도 언마운트되지 않는다(idea.md #35 2단계). 하지만 폴더↔프로젝트
 * 스코프 탭 전환 등으로 AiChatPanel이 리마운트될 수 있으므로 스코프 키 맵으로
 * messages·draft·스크롤위치를 캐싱해 즉시 복원한다(idea.md #35 1단계).
 */
export interface ChatScopeState {
  messages: ChatMessage[]
  loading: boolean
  /** 입력창 draft — 리마운트 시 복원. */
  draft: string
  /** 본문 스크롤 위치(px) — 리마운트 시 복원. */
  scrollTop: number
  /** 확대 보기로 띄운 메시지 — 리마운트 시 복원. */
  expandedMessage: ChatMessage | null
  /** MD 저장 진행 중인 메시지 id. */
  savingMessageId: number | null
  /** MD 저장 에러(메시지별). */
  saveError: { id: number; message: string } | null
}

export function scopeKey(scopeType: ChatScopeType, scopeId: number): string {
  return `${scopeType}:${scopeId}`
}

export function emptyScope(): ChatScopeState {
  return {
    messages: [],
    loading: false,
    draft: '',
    scrollTop: 0,
    expandedMessage: null,
    savingMessageId: null,
    saveError: null,
  }
}

interface ChatState {
  scopes: Record<string, ChatScopeState>
  /** 읽기 전용 접근자 — 없으면 빈 스코프 반환(새 참조이므로 셀렉터엔 사용 금지, 명령형 읽기 전용). */
  getScope: (scopeType: ChatScopeType, scopeId: number) => ChatScopeState
  /** 스코프 patch 병합 — 없으면 빈 스코프에서 시작. */
  setScope: (scopeType: ChatScopeType, scopeId: number, patch: Partial<ChatScopeState>) => void
  load: (scopeType: ChatScopeType, scopeId: number) => Promise<void>
  refresh: (scopeType: ChatScopeType, scopeId: number) => Promise<void>
  send: (scopeType: ChatScopeType, scopeId: number, content: string) => Promise<void>
  applyUpdate: (scopeType: ChatScopeType, scopeId: number, msg: ChatMessage) => void
  setDraft: (scopeType: ChatScopeType, scopeId: number, draft: string) => void
  setScrollTop: (scopeType: ChatScopeType, scopeId: number, scrollTop: number) => void
  setExpandedMessage: (scopeType: ChatScopeType, scopeId: number, m: ChatMessage | null) => void
  setSavingMessageId: (scopeType: ChatScopeType, scopeId: number, id: number | null) => void
  setSaveError: (scopeType: ChatScopeType, scopeId: number, err: { id: number; message: string } | null) => void
  resetScope: (scopeType: ChatScopeType, scopeId: number) => void
  reset: () => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  scopes: {},

  getScope: (scopeType, scopeId) => get().scopes[scopeKey(scopeType, scopeId)] ?? emptyScope(),

  setScope: (scopeType, scopeId, patch) => {
    const key = scopeKey(scopeType, scopeId)
    set((s) => {
      const prev = s.scopes[key] ?? emptyScope()
      return { scopes: { ...s.scopes, [key]: { ...prev, ...patch } } }
    })
  },

  // 캐시 우선 로드 — 기존 messages가 있으면 그것을 먼저 보이게 둔 채(깜빡임 없음)
  // 백그라운드에서 재조회. 캐시 없으면 빈 스코프에서 로딩.
  load: async (scopeType, scopeId) => {
    const key = scopeKey(scopeType, scopeId)
    const existing = get().scopes[key]
    set((s) => ({
      scopes: {
        ...s.scopes,
        [key]: existing ? { ...existing, loading: true } : { ...emptyScope(), loading: true },
      },
    }))
    try {
      const messages = await getScopedChatMessages(scopeType, scopeId)
      set((s) => ({
        scopes: {
          ...s.scopes,
          [key]: { ...(s.scopes[key] ?? emptyScope()), messages, loading: false },
        },
      }))
    } catch (e) {
      // 로드 실패 시에도 기존 캐시는 보존. loading만 끈다.
      set((s) => ({
        scopes: {
          ...s.scopes,
          [key]: { ...(s.scopes[key] ?? emptyScope()), loading: false },
        },
      }))
      throw e
    }
  },

  // 폴링 폴백용 조용한 재조회 — 웹소켓 실시간 반영 실패 시 사용.
  // load()와 달리 loading을 건드리지 않고 캐시 messages를 유지한 채 교체(깜빡임 방지).
  refresh: async (scopeType, scopeId) => {
    const key = scopeKey(scopeType, scopeId)
    const messages = await getScopedChatMessages(scopeType, scopeId)
    set((s) => ({
      scopes: {
        ...s.scopes,
        [key]: { ...(s.scopes[key] ?? emptyScope()), messages },
      },
    }))
  },

  send: async (scopeType, scopeId, content) => {
    const key = scopeKey(scopeType, scopeId)
    const res = await sendScopedChatMessage(scopeType, scopeId, content)
    set((s) => {
      const prev = s.scopes[key] ?? emptyScope()
      return {
        scopes: {
          ...s.scopes,
          [key]: { ...prev, messages: [...prev.messages, res.user_message, res.assistant_message] },
        },
      }
    })
  },

  applyUpdate: (scopeType, scopeId, msg) => {
    const key = scopeKey(scopeType, scopeId)
    set((s) => {
      const prev = s.scopes[key] ?? emptyScope()
      return {
        scopes: {
          ...s.scopes,
          [key]: { ...prev, messages: prev.messages.map((m) => (m.id === msg.id ? { ...m, ...msg } : m)) },
        },
      }
    })
  },

  setDraft: (scopeType, scopeId, draft) => get().setScope(scopeType, scopeId, { draft }),
  setScrollTop: (scopeType, scopeId, scrollTop) => get().setScope(scopeType, scopeId, { scrollTop }),
  setExpandedMessage: (scopeType, scopeId, expandedMessage) =>
    get().setScope(scopeType, scopeId, { expandedMessage }),
  setSavingMessageId: (scopeType, scopeId, savingMessageId) =>
    get().setScope(scopeType, scopeId, { savingMessageId }),
  setSaveError: (scopeType, scopeId, saveError) => get().setScope(scopeType, scopeId, { saveError }),

  resetScope: (scopeType, scopeId) => {
    const key = scopeKey(scopeType, scopeId)
    set((s) => {
      const next = { ...s.scopes }
      delete next[key]
      return { scopes: next }
    })
  },

  reset: () => set({ scopes: {} }),
}))
