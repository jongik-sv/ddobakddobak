import { useEffect, useRef } from 'react'
import type { Transcript } from '../../api/meetings'

interface TranscriptPanelProps {
  transcripts: Transcript[]
  currentTimeMs: number
  onSeek: (ms: number) => void
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function TranscriptPanel({ transcripts, currentTimeMs, onSeek }: TranscriptPanelProps) {
  const highlightedRef = useRef<HTMLDivElement | null>(null)

  const highlightedIndex = transcripts.findIndex(
    (t) => currentTimeMs >= t.started_at_ms && currentTimeMs < t.ended_at_ms
  )

  useEffect(() => {
    if (highlightedRef.current) {
      highlightedRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [highlightedIndex])

  if (transcripts.length === 0) {
    return (
      <div className="p-4 text-sm text-gray-400">
        트랜스크립트가 없습니다.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1 p-4 overflow-y-auto">
      {transcripts.map((transcript, idx) => {
        const isHighlighted = idx === highlightedIndex
        return (
          <div
            key={transcript.id}
            ref={isHighlighted ? highlightedRef : null}
            data-highlighted={isHighlighted ? 'true' : 'false'}
            className={`p-2 rounded cursor-pointer transition-colors ${
              isHighlighted
                ? 'bg-indigo-100 border-l-4 border-indigo-500'
                : 'hover:bg-gray-100'
            }`}
            onClick={() => onSeek(transcript.started_at_ms)}
          >
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-xs font-semibold text-indigo-600">
                {transcript.speaker_label}
              </span>
              <span className="text-[10px] text-gray-400 tabular-nums">
                {formatTimestamp(transcript.started_at_ms)}
              </span>
            </div>
            <span className="text-sm text-gray-800">{transcript.content}</span>
          </div>
        )
      })}
    </div>
  )
}
