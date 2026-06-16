import { useEffect, useState } from 'react'
import { useChatStore } from '../../stores/chatStore'
import { subscribeChat } from '../../channels/chat'

export function AiChatPanel({ meetingId }: { meetingId: number }) {
  const { load, send } = useChatStore()
  const messages = useChatStore((s) => s.messages) ?? []
  const [draft, setDraft] = useState('')

  useEffect(() => {
    load(meetingId)
    const unsub = subscribeChat(meetingId)
    return unsub
  }, [meetingId, load])

  const submit = () => {
    const q = draft.trim()
    if (!q) return
    setDraft('')
    void send(meetingId, q)
  }

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <p className="text-sm text-gray-400">이 회의 내용에 대해 무엇이든 물어보세요.</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div
              className={
                m.role === 'user'
                  ? 'max-w-[80%] rounded-lg px-3 py-2 text-sm bg-blue-600 text-white whitespace-pre-wrap'
                  : 'max-w-[80%] rounded-lg px-3 py-2 text-sm bg-gray-100 text-gray-800 whitespace-pre-wrap'
              }
            >
              {m.status === 'pending' && m.role === 'assistant' ? (
                <span data-testid="chat-typing" className="text-gray-400">
                  …답변 작성 중
                </span>
              ) : m.status === 'error' ? (
                <span className="text-red-500">답변 실패: {m.error_message}</span>
              ) : (
                m.content
              )}
            </div>
          </div>
        ))}
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
