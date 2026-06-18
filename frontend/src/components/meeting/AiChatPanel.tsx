import { useEffect, useRef, useState } from 'react'
import { useChatStore } from '../../stores/chatStore'
import { subscribeChat } from '../../channels/chat'
import { ChatMarkdown } from './ChatMarkdown'
import type { ChatScopeType } from '../../api/chat'

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
  const { load, send } = useChatStore()
  const messages = useChatStore((s) => s.messages) ?? []
  const hasPending = messages.some((m) => m.status === 'pending')
  const [draft, setDraft] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    load(scopeType, scopeId)
    const unsub = subscribeChat(scopeType, scopeId)
    return unsub
  }, [scopeType, scopeId, load])

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' })
  }, [messages])

  const submit = () => {
    const q = draft.trim()
    if (!q) return
    setDraft('')
    void send(scopeType, scopeId, q)
  }

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <p className="text-sm text-gray-400">{emptyHint ?? '이 회의 내용에 대해 무엇이든 물어보세요.'}</p>
        )}
        {messages.map((m) => {
          const suggestions =
            m.role === 'assistant' && m.status === 'complete' ? (m.suggestions ?? []) : []
          return (
            <div
              key={m.id}
              className={
                m.role === 'user'
                  ? 'flex flex-col items-end'
                  : 'flex flex-col items-start'
              }
            >
              <div
                className={
                  m.role === 'user'
                    ? 'max-w-[80%] rounded-lg px-3 py-2 text-sm bg-blue-600 text-white whitespace-pre-wrap'
                    : 'max-w-[80%] rounded-lg px-3 py-2 text-sm bg-gray-100 text-gray-800'
                }
              >
                {m.status === 'pending' && m.role === 'assistant' ? (
                  <span data-testid="chat-typing" className="text-gray-400">
                    …답변 작성 중
                  </span>
                ) : m.status === 'error' ? (
                  <span className="text-red-500">답변 실패: {m.error_message}</span>
                ) : m.role === 'assistant' && m.status === 'complete' ? (
                  <ChatMarkdown content={m.content} onSeek={onSeek} onSeekMeeting={onSeekMeeting} />
                ) : (
                  m.content
                )}
              </div>
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
                      className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
      <div className="border-t border-gray-200 p-2 flex gap-2">
        <input
          className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          placeholder="회의에 질문하기…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
        <button
          onClick={submit}
          className="px-4 py-1.5 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
        >
          전송
        </button>
      </div>
    </div>
  )
}
