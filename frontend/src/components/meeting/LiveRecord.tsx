import { useEffect, useRef, useState } from 'react'
import { useTranscriptStore } from '../../stores/transcriptStore'
import { SpeakerLabel } from './SpeakerLabel'
import { EditableTranscriptText } from './EditableTranscriptText'
import { formatElapsedMs as formatElapsed } from '../../lib/audioUtils'

interface LiveRecordProps {
  meetingId: number
  currentTimeMs?: number
  onSeek?: (ms: number) => void
  onApply?: () => Promise<void>
  editable?: boolean
  /**
   * 오프라인 재생용: 병합 오디오 타임라인 기준 세그먼트 시작 오프셋(ms). unapplied 인덱스와 1:1.
   * 주어지면 started_at_ms(VAD 무음 갭을 포함한 원본 타임라인) 대신 이 오프셋으로 하이라이트를
   * 계산한다 → 무음 제거된 병합 오디오 재생 위치와 싱크가 맞는다. 온라인은 안 줌(기존 동작).
   */
  segmentOffsetsMs?: number[]
}

export function LiveRecord({ meetingId, currentTimeMs = 0, onSeek, onApply, editable = true, segmentOffsetsMs }: LiveRecordProps) {
  const finals = useTranscriptStore((s) => s.finals)
  const partial = useTranscriptStore((s) => s.partial)
  // 라이브 기록 = AI 회의록에 아직 적용되지 않은 버퍼 기록
  const unapplied = finals.filter((f) => !f.applied)
  const bottomRef = useRef<HTMLDivElement>(null)
  const highlightedRef = useRef<HTMLDivElement>(null)
  const [isApplying, setIsApplying] = useState(false)

  // currentTimeMs>0 = 재생 중(상세/뷰어). 0 = 라이브 녹음(타임업데이트 없음).
  const isPlayback = currentTimeMs > 0

  // 하이라이트 인덱스.
  // - 오프셋이 있으면(오프라인): "offset <= currentTime인 마지막 세그먼트". 병합 오디오는 무음
  //   갭이 없어 재생 중 -1이 안 나온다 → 바닥으로 튀던(위아래 점프) 현상이 사라진다.
  // - 없으면(온라인): 기존 started/ended_at_ms 범위 매칭.
  let highlightedIndex = -1
  if (isPlayback) {
    if (segmentOffsetsMs && segmentOffsetsMs.length > 0) {
      for (let i = 0; i < unapplied.length; i++) {
        const off = segmentOffsetsMs[i]
        if (off == null) break
        if (off <= currentTimeMs) highlightedIndex = i
        else break
      }
    } else {
      highlightedIndex = unapplied.findIndex((t) => currentTimeMs >= t.started_at_ms && currentTimeMs < t.ended_at_ms)
    }
  }

  // 재생 중: 하이라이트 세그먼트가 "바뀔 때만" 그 줄로 스크롤(바닥으로 끌어내리지 않음).
  useEffect(() => {
    if (highlightedIndex < 0) return
    highlightedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [highlightedIndex])

  // 라이브 녹음 중: 새 기록/부분 결과가 오면 바닥에 붙는다. 재생 중엔 동작 안 함.
  useEffect(() => {
    if (isPlayback) return
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [unapplied.length, partial, isPlayback])

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
              <span className="text-xs text-gray-400">
                {/* 오프라인 재생: 무음컷 병합 오디오 타임라인(segmentOffsetsMs)으로 표시해야
                    재생 위치와 일치한다. started_at_ms는 무음 갭 포함 절대 타임라인이라 더 길다. */}
                {formatElapsed(segmentOffsetsMs?.[idx] ?? item.started_at_ms)}
              </span>
            </div>
            <EditableTranscriptText
              transcriptId={item.id}
              meetingId={meetingId}
              content={item.content}
              editable={editable}
              className="text-sm text-gray-900 leading-relaxed"
            />
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
