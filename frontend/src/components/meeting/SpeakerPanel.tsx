import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { getSpeakers, renameSpeaker, resetSpeakers, type Speaker } from '../../api/speakers'
import { speakerColor } from './SpeakerLabel'
import { useTranscriptStore } from '../../stores/transcriptStore'
import { pickSpeakerTarget } from './speakerSeek'

interface SpeakerPanelProps {
  meetingId: number
  isRecording: boolean
  /** 데스크톱 사이드 패널용: 화자 없으면 접힘, 감지되면 자동 펼침(이후 수동 토글 우선) */
  collapsible?: boolean
  /** 잠긴 회의면 화자명 변경·초기화를 막는다 (읽기 전용). 기본 false. */
  readOnly?: boolean
  /** 현재 재생 위치(ms). 화자 배지 클릭 시 다음 발화 계산 기준. */
  currentTimeMs?: number
  /** 오디오 재생 중 여부. 콜드스타트 판정용. */
  isPlaying?: boolean
  /** 화자 배지 클릭 → 해당 ms로 seek(+자동재생). 미전달 시 배지는 비대화형 라벨. */
  onSpeakerSeek?: (ms: number) => void
}

export function SpeakerPanel({
  meetingId,
  isRecording,
  collapsible,
  readOnly = false,
  currentTimeMs,
  isPlaying,
  onSpeakerSeek,
}: SpeakerPanelProps) {
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

  // store finals의 speaker_name을 라벨→이름으로 매핑.
  // 트랜스크립트 인라인 편집이 store만 갱신해도 화자 목록 표시가 따라오도록.
  const nameByLabel = useMemo(() => {
    const m = new Map<string, string | null>()
    for (const f of finals) {
      if (!m.has(f.speaker_label)) m.set(f.speaker_label, f.speaker_name ?? null)
    }
    return m
  }, [finals])

  // 표시 이름 해석: store에 실제 이름이 있으면 store가 우선(편집 즉시 반영),
  // store에 라벨이 없거나 null이면 getSpeakers 응답(speaker.name)으로 fallback.
  // (store는 null을 보유할 수 있음 — 사이드카 이름이 있어도 "이름 없음"으로 덮지 않도록)
  const resolveName = useCallback(
    (speaker: Speaker): string => {
      if (nameByLabel.has(speaker.id)) {
        const sn = nameByLabel.get(speaker.id)
        if (sn && sn !== speaker.id) return sn
      }
      return speaker.name
    },
    [nameByLabel],
  )

  // 화자 "수"는 이름 기준 distinct: 다른 라벨이라도 같은 이름이면 1명.
  // 이름 없는 라벨(name===id)은 각자 id로 구분되어 별개 카운트.
  const distinctSpeakerCount = useMemo(
    () => new Set(visibleSpeakers.map((s) => resolveName(s))).size,
    [visibleSpeakers, resolveName],
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
    const resolved = resolveName(speaker)
    setEditValue(resolved === speaker.id ? '' : resolved)
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

  // 마지막 점프 ms(이 인스턴스 한정) — 빠른 연타로 timeupdate가 아직 안 온 경우 base 보강용
  const lastJumpMsRef = useRef<number>(-1)
  function jumpToSpeaker(speakerId: string) {
    if (!onSpeakerSeek) return
    const utts = finals.filter((f) => f.speaker_label === speakerId) // store는 started_at_ms asc 유지
    const target = pickSpeakerTarget(utts, {
      currentTimeMs: currentTimeMs ?? 0,
      isPlaying: !!isPlaying,
      lastJumpMs: lastJumpMsRef.current,
    })
    if (!target) return
    lastJumpMsRef.current = target.started_at_ms
    onSpeakerSeek(target.started_at_ms)
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

        {visibleSpeakers.map((speaker) => {
          // 배지 공통 클래스 — span/button 두 분기 드리프트 방지
          const badgeClass = `shrink-0 inline-block px-2 py-0.5 rounded text-xs font-semibold ${speakerColor(speaker.id)}`
          const display = resolveName(speaker)
          return (
          <div key={speaker.id} className="flex items-center gap-2 min-h-[44px]">
            {onSpeakerSeek ? (
              <button
                type="button"
                onClick={() => jumpToSpeaker(speaker.id)}
                title="이 화자 발화로 이동"
                className={`${badgeClass} cursor-pointer hover:ring-1 hover:ring-blue-300`}
              >
                {speaker.id}
              </button>
            ) : (
              <span className={badgeClass}>{speaker.id}</span>
            )}

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
                {display !== speaker.id ? display : <span className="text-gray-400 italic">이름 없음</span>}
              </button>
            )}
          </div>
          )
        })}
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
