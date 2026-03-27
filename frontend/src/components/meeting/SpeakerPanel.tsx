import { useState, useEffect, useCallback, useMemo } from 'react'
import { getSpeakers, renameSpeaker, resetSpeakers, type Speaker } from '../../api/speakers'
import { speakerColor } from './SpeakerLabel'
import { useTranscriptStore } from '../../stores/transcriptStore'

interface SpeakerPanelProps {
  meetingId: number
  isRecording: boolean
}

export function SpeakerPanel({ meetingId, isRecording }: SpeakerPanelProps) {
  const [speakers, setSpeakers] = useState<Speaker[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  // 실제 기록에 등장한 화자 ID 집합
  const finals = useTranscriptStore((s) => s.finals)
  const usedSpeakerIds = useMemo(
    () => new Set(finals.map((f) => f.speaker_label).filter(Boolean)),
    [finals]
  )

  // 기록에 실제 등장한 화자만 표시 (DB에 있지만 기록에 없는 화자 제외)
  const visibleSpeakers = useMemo(
    () => speakers.filter((s) => usedSpeakerIds.has(s.id)),
    [speakers, usedSpeakerIds]
  )

  const fetchSpeakers = useCallback(() => {
    getSpeakers(meetingId)
      .then(setSpeakers)
      .catch(() => {})
  }, [meetingId])

  // 초기 로드 + 녹음 중 10초마다 갱신
  useEffect(() => {
    fetchSpeakers()
  }, [fetchSpeakers])

  useEffect(() => {
    if (!isRecording) return
    const id = setInterval(fetchSpeakers, 10_000)
    return () => clearInterval(id)
  }, [isRecording, fetchSpeakers])

  function startEdit(speaker: Speaker) {
    setEditingId(speaker.id)
    setEditValue(speaker.name === speaker.id ? '' : speaker.name)
  }

  async function submitEdit(speaker: Speaker) {
    const name = editValue.trim()
    if (name && name !== speaker.name) {
      const updated = await renameSpeaker(meetingId, speaker.id, name).catch(() => null)
      if (updated) {
        setSpeakers((prev) =>
          prev.map((s) => (s.id === speaker.id ? { ...s, name: updated.name } : s))
        )
      }
    }
    setEditingId(null)
  }

  function handleKeyDown(e: React.KeyboardEvent, speaker: Speaker) {
    if (e.key === 'Enter') submitEdit(speaker)
    else if (e.key === 'Escape') setEditingId(null)
  }

  async function handleReset() {
    if (!confirm('화자 DB를 초기화하면 화자 구분이 처음부터 다시 시작됩니다. 계속할까요?')) return
    await resetSpeakers(meetingId).catch(() => {})
    setSpeakers([])
  }

  if (visibleSpeakers.length === 0) {
    return (
      <div className="p-4 text-xs text-gray-400">
        {isRecording ? '화자 감지 대기 중...' : '감지된 화자 없음'}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500">화자 목록</span>
        <button
          onClick={handleReset}
          className="text-xs text-red-400 hover:text-red-600"
          title="화자 DB 초기화"
        >
          초기화
        </button>
      </div>

      {visibleSpeakers.map((speaker) => (
        <div key={speaker.id} className="flex items-center gap-2">
          <span
            className={`shrink-0 inline-block px-2 py-0.5 rounded text-xs font-semibold ${speakerColor(speaker.id)}`}
          >
            {speaker.id}
          </span>

          {editingId === speaker.id ? (
            <input
              autoFocus
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => submitEdit(speaker)}
              onKeyDown={(e) => handleKeyDown(e, speaker)}
              placeholder={speaker.id}
              className="flex-1 text-xs border-b border-blue-400 outline-none bg-transparent py-0.5"
            />
          ) : (
            <button
              onClick={() => startEdit(speaker)}
              className="flex-1 text-left text-xs text-gray-700 hover:text-blue-600 truncate"
              title="클릭하여 이름 편집"
            >
              {speaker.name !== speaker.id ? speaker.name : <span className="text-gray-400 italic">이름 없음</span>}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
