import { useState } from 'react'
import type { ReactNode } from 'react'
import { AiChatPanel } from './AiChatPanel'

type Tab = 'memo' | 'corrections' | 'chat'

export function RightTabsPanel({
  meetingId,
  memo,
  corrections,
  onSeek,
}: {
  meetingId: number
  memo: ReactNode
  /** 오타수정 탭 콘텐츠. 제공 시 메모와 AI 챗 사이에 3번째 탭으로 노출. 미제공 시 2탭(메모/AI 챗). */
  corrections?: ReactNode
  onSeek?: (ms: number) => void
}) {
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
        {corrections != null && (
          <button className={btn('corrections')} onClick={() => setTab('corrections')}>
            오타수정
          </button>
        )}
        <button className={btn('chat')} onClick={() => setTab('chat')}>
          AI 챗
        </button>
      </div>
      <div className="flex-1 min-h-0">
        {tab === 'memo'
          ? memo
          : tab === 'corrections'
            ? corrections
            : <AiChatPanel scopeId={meetingId} onSeek={onSeek} />}
      </div>
    </div>
  )
}
