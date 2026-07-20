import { useState } from 'react'
import { LiveRecord } from './LiveRecord'
import { FullRecord } from './FullRecord'
import { useTranscriptStore } from '../../stores/transcriptStore'

type Tab = 'live' | 'all'

interface RecordTabPanelProps {
  meetingId: number
  currentTimeMs?: number
  onSeek?: (ms: number) => void
  /** 잠긴 회의면 라이브/전체 기록의 전사 편집·삭제를 막는다 (탐색·재생은 가능). 기본 false. */
  readOnly?: boolean
}

export function RecordTabPanel({ meetingId, currentTimeMs = 0, onSeek, readOnly = false }: RecordTabPanelProps) {
  const [tab, setTab] = useState<Tab>('live')
  // 탭바 건수 배지 — LiveRecord/FullRecord가 읽는 것과 동일한 finals를 구독해
  // 탭 전환 없이도 양쪽 건수가 항상 실제 렌더 항목 수와 일치하도록 한다.
  const finals = useTranscriptStore((s) => s.finals)
  // 라이브 기록 = LiveRecord의 unapplied와 동일한 술어
  const liveCount = finals.filter((f) => !f.applied).length
  // 전체 기록 = FullRecord가 렌더하는 세그먼트 수(화자별 그룹 수 아님)
  const allCount = finals.length

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 탭바 */}
      <div className="flex border-b bg-muted shrink-0">
        <button
          onClick={() => setTab('live')}
          className={`flex-1 px-3 py-2 min-h-[44px] text-xs font-medium transition-colors ${
            tab === 'live'
              ? 'text-blue-600 border-b-2 border-blue-600 bg-card'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          라이브 기록<span className="ml-1">({liveCount})</span>
        </button>
        <button
          onClick={() => setTab('all')}
          className={`flex-1 px-3 py-2 min-h-[44px] text-xs font-medium transition-colors ${
            tab === 'all'
              ? 'text-blue-600 border-b-2 border-blue-600 bg-card'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          전체 기록<span className="ml-1">({allCount})</span>
        </button>
      </div>

      {/* 탭 콘텐츠 */}
      <div className="flex-1 overflow-hidden">
        {tab === 'live' ? (
          <LiveRecord meetingId={meetingId} currentTimeMs={currentTimeMs} onSeek={onSeek} editable={!readOnly} />
        ) : (
          <FullRecord meetingId={meetingId} currentTimeMs={currentTimeMs} onSeek={onSeek} readOnly={readOnly} />
        )}
      </div>
    </div>
  )
}
