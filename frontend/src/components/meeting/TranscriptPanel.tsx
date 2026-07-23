import { useEffect, useMemo, useRef } from 'react'
import type { Transcript } from '../../api/meetings'
import { renameSpeaker } from '../../api/speakers'
import { EditableTranscriptText } from './EditableTranscriptText'
import { HighlightedText } from './HighlightedText'
import { SpeakerLabel, speakerBorderColor } from './SpeakerLabel'
import { resolveHighlightIndex } from './transcriptHighlight'
import { useTranscriptStore } from '../../stores/transcriptStore'

interface TranscriptPanelProps {
  meetingId: number
  transcripts: Transcript[]
  currentTimeMs: number
  onSeek: (ms: number) => void
  /** 페이지 내 검색어. 비어있지 않으면 편집 스팬 대신 하이라이트 스팬 렌더 (검색 닫으면 편집 복귀) */
  searchQuery?: string
  /** 현재 활성 전사 매치 (세그먼트 id + 내부 occurrence 인덱스) */
  activeSearch?: { transcriptId: number; occurrence: number } | null
  /** 검색 중 오디오 싱크 자동 스크롤 억제 (검색 스크롤과 충돌 방지) */
  suppressAutoScroll?: boolean
  /** 잠긴 회의면 전사 인라인 편집을 막는다 (읽기 전용). 기본 false. */
  readOnly?: boolean
  /** 명시적 seek(마커 클릭 등)가 발생할 때마다 증가하는 tick. 증가 시 suppressAutoScroll을
   *  무시하고 강제로 스크롤한다 — 검색 중이거나 동일 세그먼트로 재-seek해도 따라가야 하므로. */
  seekTick?: number
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function TranscriptPanel({
  meetingId,
  transcripts,
  currentTimeMs,
  onSeek,
  searchQuery = '',
  activeSearch = null,
  suppressAutoScroll = false,
  readOnly = false,
  seekTick,
}: TranscriptPanelProps) {
  const highlightedRef = useRef<HTMLDivElement | null>(null)

  // EditableTranscriptText의 낙관적 갱신은 transcriptStore.finals에 들어간다.
  // MeetingPage는 transcripts를 자체 useState로 관리하므로, 갱신된 content를
  // 화면에 반영하려면 store에서 우선 조회한다.
  const storeFinals = useTranscriptStore((s) => s.finals)
  const setSpeakerName = useTranscriptStore((s) => s.setSpeakerName)
  const contentOverrides = useMemo(() => {
    const map = new Map<number, string>()
    for (const f of storeFinals) map.set(f.id, f.content)
    return map
  }, [storeFinals])

  // rename 즉시 반영: SpeakerPanel이 store finals의 speaker_name을 갱신하면
  // prop(transcripts)이 stale해도 store 값을 우선 표시한다.
  const speakerNameOverrides = useMemo(() => {
    const map = new Map<number, string | null>()
    for (const f of storeFinals) map.set(f.id, f.speaker_name ?? null)
    return map
  }, [storeFinals])

  // 포함 구간 우선, 없으면(무음 갭·회의록 시간태그 mm:ss 절삭 등) 가장 가까운 구간.
  // 시간태그 클릭으로 seek한 ms가 어떤 구간에도 안 들어가면 오디오만 재생되고 전사 선택이
  // 안 되던 문제를 해결한다(speakerAtMs의 nearest 폴백과 동일 규칙).
  const highlightedIndex = useMemo(
    () => resolveHighlightIndex(transcripts, currentTimeMs),
    [transcripts, currentTimeMs]
  )

  // 표시 병합: 해석된 이름이 연속 동일한 세그먼트를 한 그룹으로.
  // 편집/하이라이트/타임스탬프는 세그먼트별 유지 위해 flatIdx 함께 보관.
  // rename이 그룹 경계 바꾸므로 deps에 speakerNameOverrides 포함.
  const groups = useMemo(() => {
    const resolveName = (t: Transcript): string =>
      ((speakerNameOverrides.has(t.id)
        ? speakerNameOverrides.get(t.id)
        : t.speaker_name) ?? t.speaker_label)
    const out: {
      key: number
      name: string
      startedAtMs: number
      segments: { transcript: Transcript; flatIdx: number }[]
    }[] = []
    transcripts.forEach((transcript, flatIdx) => {
      const name = resolveName(transcript)
      const last = out[out.length - 1]
      if (last && last.name === name) {
        last.segments.push({ transcript, flatIdx })
      } else {
        out.push({ key: transcript.id, name, startedAtMs: transcript.started_at_ms,
          segments: [{ transcript, flatIdx }] })
      }
    })
    return out
  }, [transcripts, speakerNameOverrides])

  async function handleRename(speakerLabel: string, name: string) {
    const updated = await renameSpeaker(meetingId, speakerLabel, name).catch(() => null)
    if (updated) {
      setSpeakerName(speakerLabel, updated.name === speakerLabel ? null : updated.name)
    }
  }

  // suppressAutoScroll은 ref로 읽는다 — deps에 넣으면 검색 종료(해제) 시점에
  // 오디오 위치로 뷰포트가 튀는 스크롤이 발화한다. 인덱스가 실제로 바뀔 때만 스크롤.
  const suppressRef = useRef(suppressAutoScroll)
  suppressRef.current = suppressAutoScroll
  // seekTick이 실제로 바뀐 실행(=명시적 seek)인지 추적. 초기값을 seekTick으로 잡아
  // 마운트 시점엔 "안 바뀜"으로 취급 — 기존 마운트 스크롤 동작(억제 존중)을 그대로 유지한다.
  const prevSeekTickRef = useRef(seekTick)
  useEffect(() => {
    const tickChanged = prevSeekTickRef.current !== seekTick
    prevSeekTickRef.current = seekTick
    // 명시적 seek(tick 변화)는 검색 억제보다 우선한다 — 마커 클릭은 항상 따라가야 함.
    if (!tickChanged && suppressRef.current) return
    if (highlightedRef.current) {
      highlightedRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [highlightedIndex, seekTick])

  if (transcripts.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        트랜스크립트가 없습니다.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1 p-4 overflow-y-auto">
      {groups.map((group) => (
        <div
          key={group.key}
          className={`flex flex-col mt-3 first:mt-0 border-l-4 pl-2 ${speakerBorderColor(group.segments[0].transcript.speaker_label)}`}
        >
          <div className="flex items-center gap-2 mb-1">
            <SpeakerLabel
              speakerLabel={group.segments[0].transcript.speaker_label}
              speakerName={group.name}
              size="md"
              editable={!readOnly}
              onRename={(name) => handleRename(group.segments[0].transcript.speaker_label, name)}
            />
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {formatTimestamp(group.startedAtMs)}
            </span>
          </div>
          {group.segments.map(({ transcript, flatIdx }) => {
            const isHighlighted = flatIdx === highlightedIndex
            return (
              <div
                key={transcript.id}
                ref={isHighlighted ? highlightedRef : null}
                data-highlighted={isHighlighted ? 'true' : 'false'}
                className={`p-3 min-h-[44px] rounded cursor-pointer transition-colors ${
                  isHighlighted
                    ? 'bg-accent border-l-4 border-indigo-500'
                    : 'hover:bg-muted active:bg-muted'
                }`}
                onClick={() => onSeek(transcript.started_at_ms)}
              >
                {searchQuery ? (
                  // 검색 중엔 읽기전용 하이라이트 렌더 — contentEditable DOM에 <mark> 주입 불가
                  <HighlightedText
                    text={contentOverrides.get(transcript.id) ?? transcript.content}
                    query={searchQuery}
                    activeOccurrence={
                      activeSearch?.transcriptId === transcript.id ? activeSearch.occurrence : -1
                    }
                    className="text-sm text-foreground select-text"
                  />
                ) : (
                  <EditableTranscriptText
                    transcriptId={transcript.id}
                    meetingId={meetingId}
                    content={contentOverrides.get(transcript.id) ?? transcript.content}
                    editable={!readOnly}
                    className="text-sm text-foreground select-text"
                  />
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
