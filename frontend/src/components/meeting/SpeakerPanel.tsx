import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { getSpeakers, renameSpeaker, resetSpeakers, type Speaker } from '../../api/speakers'
import { speakerColor } from './SpeakerLabel'
import { useTranscriptStore } from '../../stores/transcriptStore'

interface SpeakerPanelProps {
  meetingId: number
  isRecording: boolean
  /** 데스크톱 사이드 패널용: 화자 없으면 접힘, 감지되면 자동 펼침(이후 수동 토글 우선) */
  collapsible?: boolean
  /** 잠긴 회의면 화자명 변경·초기화를 막는다 (읽기 전용). 기본 false. */
  readOnly?: boolean
}

export function SpeakerPanel({ meetingId, isRecording, collapsible, readOnly = false }: SpeakerPanelProps) {
  const [speakers, setSpeakers] = useState<Speaker[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  // 실제 기록에 등장한 화자 ID 집합
  const finals = useTranscriptStore((s) => s.finals)
  const setSpeakerName = useTranscriptStore((s) => s.setSpeakerName)
  const clearSpeakerNames = useTranscriptStore((s) => s.clearSpeakerNames)
  const usedSpeakerIds = useMemo(
    () => new Set(finals.map((f) => f.speaker_label).filter(Boolean)),
    [finals]
  )

  // 기록에 실제 등장한 화자만 표시 (DB에 있지만 기록에 없는 화자 제외)
  const visibleSpeakers = useMemo(
    () => speakers.filter((s) => usedSpeakerIds.has(s.id)),
    [speakers, usedSpeakerIds]
  )

  // 화자 "수"는 이름 기준 distinct: 다른 라벨이라도 같은 이름이면 1명.
  // 이름 없는 라벨(name===id)은 각자 id로 구분되어 별개 카운트.
  const distinctSpeakerCount = useMemo(
    () => new Set(visibleSpeakers.map((s) => s.name || s.id)).size,
    [visibleSpeakers]
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

  // collapsible 상태
  const [open, setOpen] = useState(false)
  const userToggledRef = useRef(false)

  // 화자가 처음 감지되면 자동 펼침 — 사용자가 직접 토글한 뒤에는 개입하지 않음
  useEffect(() => {
    if (!userToggledRef.current && visibleSpeakers.length > 0) setOpen(true)
  }, [visibleSpeakers.length])

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
        setSpeakerName(speaker.id, updated.name === speaker.id ? null : updated.name)
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
    clearSpeakerNames()
  }

  // body: 기존 렌더 내용 (collapsible/비-collapsible 공통)
  const body =
    visibleSpeakers.length === 0 ? (
      <div className="p-4 text-xs text-gray-400">
        {isRecording ? '화자 감지 대기 중...' : '감지된 화자 없음'}
      </div>
    ) : (
      <div className="flex flex-col gap-2 p-4">
        <div className="flex items-center justify-between">
          {/* collapsible 모드에서는 summary가 라벨 역할을 하므로 헤더 라벨 숨김 */}
          {!collapsible && (
            <span className="text-xs font-semibold text-gray-500">화자 목록</span>
          )}
          <button
            onClick={handleReset}
            disabled={readOnly}
            className="text-xs text-red-400 hover:text-red-600 min-h-[44px] flex items-center disabled:opacity-40 disabled:cursor-not-allowed"
            title={readOnly ? '잠긴 회의입니다' : '화자 DB 초기화'}
          >
            초기화
          </button>
        </div>

        {visibleSpeakers.map((speaker) => (
          <div key={speaker.id} className="flex items-center gap-2 min-h-[44px]">
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
                onClick={() => { if (!readOnly) startEdit(speaker) }}
                disabled={readOnly}
                className="flex-1 text-left text-xs text-gray-700 hover:text-blue-600 truncate disabled:hover:text-gray-700 disabled:cursor-not-allowed"
                title={readOnly ? '잠긴 회의입니다' : '클릭하여 이름 편집'}
              >
                {speaker.name !== speaker.id ? speaker.name : <span className="text-gray-400 italic">이름 없음</span>}
              </button>
            )}
          </div>
        ))}
      </div>
    )

  if (!collapsible) {
    return body
  }

  return (
    <details open={open}>
      <summary
        onClick={(e) => {
          e.preventDefault()
          userToggledRef.current = true
          setOpen((v) => !v)
        }}
        className="px-4 py-2 text-xs font-semibold text-gray-500 cursor-pointer hover:bg-gray-50 select-none"
      >
        화자 목록{visibleSpeakers.length > 0 ? ` (${distinctSpeakerCount})` : ''}
      </summary>
      {body}
    </details>
  )
}
