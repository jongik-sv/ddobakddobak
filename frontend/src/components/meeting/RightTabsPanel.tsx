import { useState } from 'react'
import type { ReactNode } from 'react'
import { AiChatPanel } from './AiChatPanel'

type Tab = 'memo' | 'chat'

export function RightTabsPanel({ meetingId, memo }: { meetingId: number; memo: ReactNode }) {
  const [tab, setTab] = useState<Tab>('memo')
  const btn = (t: Tab) =>
    `px-3 py-1.5 text-sm font-medium ${
      tab === t ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'
    }`
  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-gray-200 shrink-0">
        <button className={btn('memo')} onClick={() => setTab('memo')}>
          메모
        </button>
        <button className={btn('chat')} onClick={() => setTab('chat')}>
          AI 챗
        </button>
      </div>
      <div className="flex-1 min-h-0">
        {tab === 'memo' ? memo : <AiChatPanel meetingId={meetingId} />}
      </div>
    </div>
  )
}
