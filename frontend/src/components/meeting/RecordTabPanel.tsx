import { useState } from 'react'
import { LiveRecord } from './LiveRecord'
import { FullRecord } from './FullRecord'

type Tab = 'live' | 'all'

interface RecordTabPanelProps {
  meetingId: number
  currentTimeMs?: number
  onSeek?: (ms: number) => void
  onApply?: () => Promise<void>
}

export function RecordTabPanel({ meetingId, currentTimeMs = 0, onSeek, onApply }: RecordTabPanelProps) {
  const [tab, setTab] = useState<Tab>('live')

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 탭바 */}
      <div className="flex border-b bg-gray-50 shrink-0">
        <button
          onClick={() => setTab('live')}
          className={`flex-1 px-3 py-2 min-h-[44px] text-xs font-medium transition-colors ${
            tab === 'live'
              ? 'text-blue-600 border-b-2 border-blue-600 bg-white'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          라이브 기록
        </button>
        <button
          onClick={() => setTab('all')}
          className={`flex-1 px-3 py-2 min-h-[44px] text-xs font-medium transition-colors ${
            tab === 'all'
              ? 'text-blue-600 border-b-2 border-blue-600 bg-white'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          전체 기록
        </button>
      </div>

      {/* 탭 콘텐츠 */}
      <div className="flex-1 overflow-hidden">
        {tab === 'live' ? (
          <LiveRecord currentTimeMs={currentTimeMs} onSeek={onSeek} onApply={onApply} />
        ) : (
          <FullRecord meetingId={meetingId} currentTimeMs={currentTimeMs} onSeek={onSeek} />
        )}
      </div>
    </div>
  )
}
