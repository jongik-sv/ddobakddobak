import { useState } from 'react'
import { LiveTranscript } from './LiveTranscript'
import { FullTranscript } from './FullTranscript'

type Tab = 'live' | 'all'

interface TranscriptTabPanelProps {
  meetingId: number
  currentTimeMs?: number
  onSeek?: (ms: number) => void
}

export function TranscriptTabPanel({ meetingId, currentTimeMs = 0, onSeek }: TranscriptTabPanelProps) {
  const [tab, setTab] = useState<Tab>('live')

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 탭바 */}
      <div className="flex border-b bg-gray-50 shrink-0">
        <button
          onClick={() => setTab('live')}
          className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
            tab === 'live'
              ? 'text-blue-600 border-b-2 border-blue-600 bg-white'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          실시간 자막
        </button>
        <button
          onClick={() => setTab('all')}
          className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
            tab === 'all'
              ? 'text-blue-600 border-b-2 border-blue-600 bg-white'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          전체 자막
        </button>
      </div>

      {/* 탭 콘텐츠 */}
      <div className="flex-1 overflow-hidden">
        {tab === 'live' ? (
          <LiveTranscript currentTimeMs={currentTimeMs} onSeek={onSeek} />
        ) : (
          <FullTranscript meetingId={meetingId} currentTimeMs={currentTimeMs} onSeek={onSeek} />
        )}
      </div>
    </div>
  )
}
