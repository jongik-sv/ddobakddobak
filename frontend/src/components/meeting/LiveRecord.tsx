import { useEffect, useRef, useState } from 'react'
import { useTranscriptStore } from '../../stores/transcriptStore'
import { SpeakerLabel } from './SpeakerLabel'

/** 녹음 시작으로부터의 경과 시간(ms)을 MM:SS 형식으로 변환 */
function formatElapsed(ms: number): string {
  if (ms <= 0) return '00:00'
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60).toString().padStart(2, '0')
  const s = (totalSec % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

interface LiveRecordProps {
  currentTimeMs?: number
  onSeek?: (ms: number) => void
  onApply?: () => Promise<void>
}

export function LiveRecord({ currentTimeMs = 0, onSeek, onApply }: LiveRecordProps) {
  const finals = useTranscriptStore((s) => s.finals)
  const partial = useTranscriptStore((s) => s.partial)
  // 라이브 기록 = AI 회의록에 아직 적용되지 않은 버퍼 기록
  const unapplied = finals.filter((f) => !f.applied)
  const bottomRef = useRef<HTMLDivElement>(null)
  const highlightedRef = useRef<HTMLDivElement>(null)
  const [isApplying, setIsApplying] = useState(false)

  const highlightedIndex = currentTimeMs > 0
    ? unapplied.findIndex((t) => currentTimeMs >= t.started_at_ms && currentTimeMs < t.ended_at_ms)
    : -1

  useEffect(() => {
    if (highlightedIndex >= 0 && highlightedRef.current) {
      highlightedRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    } else {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [unapplied.length, partial, highlightedIndex])

  const handleApply = async () => {
    if (!onApply || isApplying) return
    setIsApplying(true)
    try {
      await onApply()
    } finally {
      setIsApplying(false)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 적용 버튼 */}
      {onApply && unapplied.length > 0 && (
        <div className="flex items-center justify-between px-4 py-2 border-b bg-amber-50 shrink-0">
          <span className="text-xs text-amber-700">
            미적용 {unapplied.length}건
          </span>
          <button
            onClick={handleApply}
            disabled={isApplying}
            className="px-3 py-1 rounded-md text-xs font-medium bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 transition-colors"
          >
            {isApplying ? '적용 중...' : '회의록에 적용'}
          </button>
        </div>
      )}

      <div className="flex flex-col gap-3 overflow-y-auto p-4 flex-1">
      {unapplied.length === 0 && !partial && (
        <p className="text-sm text-gray-400">새로운 기록을 기다리는 중...</p>
      )}

      {unapplied.map((item, idx) => {
        const isHighlighted = idx === highlightedIndex
        return (
          <div
            key={item.id}
            ref={isHighlighted ? highlightedRef : null}
            className={`flex flex-col gap-1 p-2 rounded transition-colors ${
              isHighlighted
                ? 'bg-indigo-100 border-l-4 border-indigo-500'
                : onSeek ? 'cursor-pointer hover:bg-gray-100' : ''
            }`}
            onClick={() => onSeek?.(item.started_at_ms)}
          >
            <div className="flex items-center gap-2">
              <SpeakerLabel speakerLabel={item.speaker_label} />
              <span className="text-xs text-gray-400">{formatElapsed(item.started_at_ms)}</span>
            </div>
            <p className="text-sm text-gray-900 leading-relaxed">{item.content}</p>
          </div>
        )
      })}

      {partial && (
        <div className="flex flex-col gap-1 opacity-70">
          <SpeakerLabel speakerLabel={partial.speaker_label} />
          <p
            data-testid="partial-text"
            className="text-sm text-gray-500 italic leading-relaxed"
          >
            {partial.content}
          </p>
        </div>
      )}

      <div ref={bottomRef} />
      </div>
    </div>
  )
}
