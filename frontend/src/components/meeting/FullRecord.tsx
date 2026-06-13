import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranscriptStore } from '../../stores/transcriptStore'
import { SpeakerLabel } from './SpeakerLabel'
import { EditableTranscriptText } from './EditableTranscriptText'
import { deleteTranscripts } from '../../api/meetings'
import { formatElapsedMs as formatElapsed } from '../../lib/audioUtils'

interface FullRecordProps {
  meetingId: number
  currentTimeMs?: number
  onSeek?: (ms: number) => void
}

export function FullRecord({ meetingId, currentTimeMs = 0, onSeek }: FullRecordProps) {
  const finals = useTranscriptStore((s) => s.finals)
  const removeFinals = useTranscriptStore((s) => s.removeFinals)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const highlightedRef = useRef<HTMLDivElement>(null)

  const highlightedIndex = currentTimeMs > 0
    ? finals.findIndex((t) => currentTimeMs >= t.started_at_ms && currentTimeMs < t.ended_at_ms)
    : -1

  // 표시 병합: 해석된 이름이 연속 동일한 세그먼트를 한 그룹으로.
  // 선택/하이라이트/대기 배지는 세그먼트별 유지 위해 flatIdx 함께 보관.
  const groups = useMemo(() => {
    const resolveName = (t: (typeof finals)[number]): string =>
      t.speaker_name && t.speaker_name.trim() ? t.speaker_name : t.speaker_label
    const out: {
      key: number
      name: string
      startedAtMs: number
      segments: { item: (typeof finals)[number]; flatIdx: number }[]
    }[] = []
    finals.forEach((item, flatIdx) => {
      const name = resolveName(item)
      const last = out[out.length - 1]
      if (last && last.name === name) {
        last.segments.push({ item, flatIdx })
      } else {
        out.push({
          key: item.id,
          name,
          startedAtMs: item.started_at_ms,
          segments: [{ item, flatIdx }],
        })
      }
    })
    return out
  }, [finals])

  useEffect(() => {
    if (highlightedIndex >= 0 && highlightedRef.current) {
      highlightedRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [highlightedIndex])

  const toggleSelect = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    if (selected.size === finals.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(finals.map((f) => f.id)))
    }
  }, [finals, selected.size])

  const handleDelete = useCallback(async () => {
    if (selected.size === 0) return
    setDeleting(true)
    try {
      const ids = Array.from(selected)
      await deleteTranscripts(meetingId, ids)
      removeFinals(ids)
      setSelected(new Set())
    } catch {
      // ignore
    } finally {
      setDeleting(false)
    }
  }, [meetingId, selected, removeFinals])

  return (
    <div className="flex flex-col h-full">
      {/* 전체 기록 리스트 */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
        {finals.length === 0 && (
          <p className="text-sm text-gray-400">기록이 없습니다.</p>
        )}

        {groups.map((group) => {
          const first = group.segments[0].item
          return (
            <div key={group.key} className="flex flex-col">
              {/* 그룹 헤더: 화자 칩 + 그룹 시작 타임스탬프 (연속 동일 화자 1회) */}
              <div className="flex items-center gap-2 mb-0.5 px-2">
                <SpeakerLabel speakerLabel={first.speaker_label} speakerName={first.speaker_name} />
                <span className="text-xs text-gray-400">{formatElapsed(group.startedAtMs)}</span>
              </div>
              {group.segments.map(({ item, flatIdx }) => {
                const isHighlighted = flatIdx === highlightedIndex
                return (
                  <div
                    key={item.id}
                    ref={isHighlighted ? highlightedRef : null}
                    className={`flex items-start gap-2 p-2 rounded transition-colors ${
                      isHighlighted
                        ? 'bg-indigo-100 border-l-4 border-indigo-500'
                        : selected.has(item.id) ? 'bg-red-50' : 'hover:bg-gray-50'
                    } ${onSeek ? 'cursor-pointer' : ''}`}
                    onClick={() => onSeek?.(item.started_at_ms)}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(item.id)}
                      onChange={() => toggleSelect(item.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-1 shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      {!item.applied && (
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700">
                            대기
                          </span>
                        </div>
                      )}
                      <EditableTranscriptText
                        transcriptId={item.id}
                        meetingId={meetingId}
                        content={item.content}
                        editable
                        className="text-sm text-gray-900 leading-relaxed"
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>

      {/* 하단 선택 삭제 바 */}
      {finals.length > 0 && (
        <div className="border-t bg-gray-50 px-4 py-2 flex items-center justify-between shrink-0">
          <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
            <input
              type="checkbox"
              checked={selected.size === finals.length && finals.length > 0}
              onChange={toggleAll}
            />
            전체 선택
          </label>
          <div className="flex items-center gap-2">
            {selected.size > 0 && (
              <span className="text-xs text-gray-500">{selected.size}개 선택</span>
            )}
            <button
              onClick={handleDelete}
              disabled={selected.size === 0 || deleting}
              className="px-3 py-1.5 text-xs font-medium rounded bg-red-500 text-white hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {deleting ? '삭제 중...' : '선택 삭제'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
