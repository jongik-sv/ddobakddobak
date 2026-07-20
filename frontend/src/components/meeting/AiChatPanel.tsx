import { useEffect, useRef } from 'react'
import { Maximize2, Download } from 'lucide-react'
import { useChatStore, scopeKey } from '../../stores/chatStore'
import { subscribeChat } from '../../channels/chat'
import { ChatMarkdown } from './ChatMarkdown'
import { ChatExpandDialog } from './ChatExpandDialog'
import { downloadChatAnswer } from '../../lib/chatExport'
import type { ChatMessage, ChatScopeType } from '../../api/chat'

function ModelBadge() {
  return (
    <span
      aria-hidden
      className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted text-muted-foreground text-[11px]"
    >
      🤖
    </span>
  )
}

export function AiChatPanel({
  scopeType = 'meeting',
  scopeId,
  onSeek,
  onSeekMeeting,
  emptyHint,
}: {
  scopeType?: ChatScopeType
  scopeId: number
  onSeek?: (ms: number) => void
  onSeekMeeting?: (meetingId: number, ms: number) => void
  emptyHint?: string
}) {
  const key = scopeKey(scopeType, scopeId)
  const load = useChatStore((s) => s.load)
  const send = useChatStore((s) => s.send)
  const refresh = useChatStore((s) => s.refresh)
  const setDraft = useChatStore((s) => s.setDraft)
  const setScrollTop = useChatStore((s) => s.setScrollTop)
  const setExpandedMessage = useChatStore((s) => s.setExpandedMessage)
  const setSavingMessageId = useChatStore((s) => s.setSavingMessageId)
  const setSaveError = useChatStore((s) => s.setSaveError)
  const messages = useChatStore((s) => s.scopes[key]?.messages ?? [])
  const draft = useChatStore((s) => s.scopes[key]?.draft ?? '')
  const expandedMessage = useChatStore((s) => s.scopes[key]?.expandedMessage ?? null)
  const savingMessageId = useChatStore((s) => s.scopes[key]?.savingMessageId ?? null)
  const saveError = useChatStore((s) => s.scopes[key]?.saveError ?? null)
  const hasPending = messages.some((m) => m.status === 'pending')
  // 웹소켓 실시간 반영이 간헐적으로 실패하는 문제의 폴백: pending/streaming인 assistant
  // 메시지가 남아있는 동안 주기적으로 재조회한다. error가 되면(또는 완료되면) 자동 중단.
  const isPolling = messages.some(
    (m) => m.role === 'assistant' && (m.status === 'pending' || m.status === 'streaming'),
  )
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  // 이전 messages 길이 — 신규 메시지 추가 시에만 하단 스크롤하기 위함.
  const prevLenRef = useRef(0)
  // 초기 스크롤 처리(캐시 복원 vs 첫 하단 이동)를 한 번만 수행하는 가드.
  const didInitScrollRef = useRef(false)

  useEffect(() => {
    load(scopeType, scopeId)
    const unsub = subscribeChat(scopeType, scopeId)
    return unsub
  }, [scopeType, scopeId, load])

  useEffect(() => {
    if (!isPolling) return
    const POLL_INTERVAL_MS = 3000
    const MAX_POLL_DURATION_MS = 5 * 60 * 1000 // 안전 타임아웃 — pending이 영원히 남는 케이스 대비
    const startedAt = Date.now()
    const interval = setInterval(() => {
      if (Date.now() - startedAt >= MAX_POLL_DURATION_MS) {
        clearInterval(interval)
        return
      }
      void refresh(scopeType, scopeId)
    }, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [isPolling, scopeType, scopeId, refresh])

  // messages 변경 시: 첫 번째 실행은 캐시(저장된 scrollTop + 기존 대화)가 있으면 복원,
  // 이후는 "신규 메시지 추가된 경우만" 맨 아래로 스크롤.
  // 과거엔 messages 변경마다 무조건 맨 아래로 갔는데, 리마운트 시 캐시로 복원한 scrollTop과
  // 충돌해 사용자가 보던 위치가 날아갔다. (idea.md #35)
  // 캐시 판정은 messages 길이로 — 빈 스코프(load가 막 만든 loading 갱신 등)는 복원 무의미.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (!didInitScrollRef.current) {
      didInitScrollRef.current = true
      const cached = useChatStore.getState().scopes[key]
      if (cached && cached.messages.length > 0) {
        // 캐시 hit — 저장해둔 스크롤 위치 복원. 하단 자동 스크롤은 하지 않는다.
        el.scrollTop = cached.scrollTop
        prevLenRef.current = cached.messages.length
        return
      }
      // 캐시 없음 — 최초 도착하는 메시지는 후속 effect에서 하단으로.
      prevLenRef.current = 0
      return
    }
    if (messages.length > prevLenRef.current) {
      bottomRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' })
    }
    prevLenRef.current = messages.length
  }, [messages, key])

  const submit = () => {
    const q = draft.trim()
    if (!q) return
    setDraft(scopeType, scopeId, '')
    void send(scopeType, scopeId, q)
  }

  const handleSaveAnswer = async (m: ChatMessage) => {
    setSavingMessageId(scopeType, scopeId, m.id)
    setSaveError(scopeType, scopeId, null)
    try {
      await downloadChatAnswer(m.content)
    } catch {
      setSaveError(scopeType, scopeId, { id: m.id, message: '저장에 실패했습니다. 다시 시도해 주세요.' })
    } finally {
      setSavingMessageId(scopeType, scopeId, null)
    }
  }

  return (
    <div className="flex flex-col h-full bg-card">
      <div
        ref={scrollRef}
        onScroll={(e) => setScrollTop(scopeType, scopeId, (e.target as HTMLDivElement).scrollTop)}
        className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
      >
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground">{emptyHint ?? '이 회의 내용에 대해 무엇이든 물어보세요.'}</p>
        )}
        {messages.map((m) => {
          const isCompleteAssistant = m.role === 'assistant' && m.status === 'complete'
          const suggestions = isCompleteAssistant ? (m.suggestions ?? []) : []
          return (
            <div
              key={m.id}
              className={
                m.role === 'user'
                  ? 'flex flex-col items-end'
                  : 'flex flex-col items-start'
              }
            >
              {m.role === 'assistant' && (
                <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ModelBadge />
                  <span>{m.model_name ?? 'AI'}</span>
                </div>
              )}
              <div
                className={
                  m.role === 'user'
                    ? 'max-w-[80%] rounded-lg px-3 py-2 text-sm bg-blue-600 text-white whitespace-pre-wrap'
                    : 'max-w-[80%] rounded-lg px-3 py-2 text-sm bg-muted text-foreground'
                }
              >
                {m.status === 'pending' && m.role === 'assistant' ? (
                  <span data-testid="chat-typing" className="text-muted-foreground">
                    …답변 작성 중
                  </span>
                ) : m.status === 'streaming' && m.role === 'assistant' ? (
                  <span className="whitespace-pre-wrap">{m.content}</span>
                ) : m.status === 'error' ? (
                  <span className="text-red-500">답변 실패: {m.error_message}</span>
                ) : m.role === 'assistant' && m.status === 'complete' ? (
                  <ChatMarkdown content={m.content} onSeek={onSeek} onSeekMeeting={onSeekMeeting} />
                ) : (
                  m.content
                )}
              </div>
              {isCompleteAssistant && (
                <div className="mt-1 flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => setExpandedMessage(scopeType, scopeId, m)}
                    aria-label="확대 보기"
                    title="확대 보기"
                    className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSaveAnswer(m)}
                    disabled={savingMessageId === m.id}
                    aria-label={savingMessageId === m.id ? 'MD 저장 중...' : 'MD 저장'}
                    title="MD 저장"
                    className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              {saveError?.id === m.id && (
                <p className="mt-0.5 text-xs text-red-500">{saveError.message}</p>
              )}
              {suggestions.length > 0 && (
                <div data-testid="chat-suggestions" className="mt-1.5 flex flex-wrap gap-1.5">
                  {suggestions.slice(0, 3).map((q, i) => (
                    <button
                      key={i}
                      type="button"
                      disabled={hasPending}
                      onClick={() => {
                        if (hasPending) return
                        void send(scopeType, scopeId, q)
                      }}
                      className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs text-blue-700 hover:bg-blue-100 dark:border-slate-600 dark:bg-slate-700 dark:font-bold dark:text-yellow-300 dark:hover:bg-slate-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>
      <div className="border-t border-border p-2 flex gap-2">
        <input
          className="flex-1 rounded-md border border-border px-3 py-1.5 text-sm"
          placeholder="회의에 질문하기…"
          value={draft}
          onChange={(e) => setDraft(scopeType, scopeId, e.target.value)}
          onKeyDown={(e) => {
            // 한글 등 IME 조합 중의 Enter는 조합 '확정'용이므로 전송하지 않는다.
            // (조합 중 전송하면 확정된 마지막 글자가 다음 질문으로 다시 날아가는 이중전송 버그 —
            //  예: "…알려줘" 전송 후 잔여 "줘"가 재전송됨.)
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit()
          }}
        />
        <button
          onClick={submit}
          className="px-4 py-1.5 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
        >
          전송
        </button>
      </div>
      {expandedMessage && (
        <ChatExpandDialog
          content={expandedMessage.content}
          onSeek={onSeek}
          onSeekMeeting={onSeekMeeting}
          onClose={() => setExpandedMessage(scopeType, scopeId, null)}
        />
      )}
    </div>
  )
}
