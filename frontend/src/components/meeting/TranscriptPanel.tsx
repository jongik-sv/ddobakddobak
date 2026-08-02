import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Scissors } from 'lucide-react'
import type { Transcript, RedactTranscriptsResponse, TranscriptBounds } from '../../api/meetings'
import { redactTranscripts } from '../../api/meetings'
import { renameSpeaker } from '../../api/speakers'
import { EditableTranscriptText } from './EditableTranscriptText'
import { HighlightedText } from './HighlightedText'
import { SpeakerLabel, speakerBorderColor } from './SpeakerLabel'
import { SplitTranscriptDialog } from './SplitTranscriptDialog'
import { resolveHighlightIndex } from './transcriptHighlight'
import { useTranscriptStore } from '../../stores/transcriptStore'
import { useToastStore } from '../../stores/toastStore'
import { confirmDialog } from '../../lib/confirmDialog'

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
  /** 분할 성공 시 호출 — 부모(MeetingPage)가 자신이 들고 있는 transcripts 배열에 inserted를
   *  끼워 넣는 등 구조적 갱신을 하도록 알린다. store 반영은 이 컴포넌트가 이미 수행한다. */
  onSplit?: (updated: Transcript, inserted: Transcript) => void
  /** owner/admin 이고 잠기지 않았을 때만 다중 선택 + 기밀 구간 절단 UI 를 노출한다. 기본 false.
   *  서버(authorize_meeting_admin!)의 403 과 이중 방어 — 여기서 숨기는 건 어포던스일 뿐이다. */
  canRedact?: boolean
  /** D'Flow 전송 이력 여부. undefined = 알 수 없음 → 경고를 표시한다(빠뜨리는 쪽이 더 위험). */
  dflowSynced?: boolean
  /** 절단 성공 시 호출 — 부모(MeetingPage)가 transcripts 배열 재조회·오디오 토큰 갱신을 하도록
   *  알린다. store 반영(removeFinals)은 이 컴포넌트가 이미 수행한다. */
  onRedacted?: (result: RedactTranscriptsResponse) => void
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
  onSplit,
  canRedact = false,
  dflowSynced,
  onRedacted,
}: TranscriptPanelProps) {
  const highlightedRef = useRef<HTMLDivElement | null>(null)
  const [splittingTranscript, setSplittingTranscript] = useState<Transcript | null>(null)
  // 선택 상태는 FullRecord.tsx:21,70-100 패턴을 그대로 미러링한다(Set + toggleSelect + toggleAll).
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [redacting, setRedacting] = useState(false)
  const removeFinalsInStore = useTranscriptStore((s) => s.removeFinals)

  // EditableTranscriptText의 낙관적 갱신은 transcriptStore.finals에 들어간다.
  // MeetingPage는 transcripts를 자체 useState로 관리하므로, 갱신된 content를
  // 화면에 반영하려면 store에서 우선 조회한다.
  const storeFinals = useTranscriptStore((s) => s.finals)
  const setSpeakerName = useTranscriptStore((s) => s.setSpeakerName)
  const applySplitInStore = useTranscriptStore((s) => s.applySplit)
  const clientId = useTranscriptStore((s) => s.clientId)
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

  const toggleSelect = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    if (selected.size === transcripts.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(transcripts.map((t) => t.id)))
    }
  }, [transcripts, selected.size])

  // 이 파일의 formatTimestamp(:33-38)는 MM:SS 고정이라 90분이 "90:00"으로 보인다.
  // 확인 다이얼로그는 회의 전체 길이를 다루므로 시 단위가 필요하다(기존 함수는 세그먼트
  // 헤더용이라 그대로 둔다 — 표시 폭이 바뀌면 레이아웃이 흔들린다).
  function formatDuration(ms: number): string {
    const total = Math.floor(ms / 1000)
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    const mm = String(m).padStart(2, '0')
    const ss = String(s).padStart(2, '0')
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
  }

  // 선택 정리: transcripts 가 갈리면(절단 후 재조회·원격 구조 변경·회의 전환) 사라진 행의 id 를
  // 버린다. FullRecord 에는 이 처리가 없지만 여기서는 필요하다 — TranscriptPanel 은 prop 배열
  // 기반이라 부모가 배열을 통째로 갈아끼우고, 남은 stale id 가 다음 요청의 transcript_ids 에
  // 실리면 서버가 422("transcript not found")로 거절한다.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev
      const alive = new Set(transcripts.map((t) => t.id))
      const next = new Set([...prev].filter((id) => alive.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [transcripts])

  const handleRedact = useCallback(async () => {
    if (selected.size === 0) return
    const rows = transcripts.filter((t) => selected.has(t.id))
    if (rows.length === 0) return

    const spans = rows
      .map((r) => `  · ${formatDuration(r.started_at_ms)} – ${formatDuration(r.ended_at_ms)}`)
      .join('\n')
    const totalMs = rows.reduce((acc, r) => acc + (r.ended_at_ms - r.started_at_ms), 0)

    const lines = [
      `선택한 ${rows.length}개 구간을 전사와 오디오에서 모두 파기합니다.`,
      spans,
      `총 길이 약 ${formatDuration(totalMs)}`,
      '',
      '⚠️ 되돌릴 수 없습니다.',
      '· 오디오도 함께 잘리며 재인코딩 손실이 있습니다.',
      // update_notes(meetings_controller.rb:758-767)가 summaries.notes_markdown 에 쓰므로,
      // summaries.destroy_all 은 사용자가 손으로 편집한 회의록까지 지운다 — 재생성으로 돌아오지
      // 않는 유일한 손실이라 별도 문장으로 명시한다.
      '· 회의록과 AI가 생성한 액션아이템·결정사항이 삭제됩니다(다시 생성해야 합니다).',
      '· 직접 편집한 회의록도 함께 삭제되며 복구되지 않습니다.',
      '· 내 챗 기록에 인용된 내용은 남습니다.',
      '· 데스크톱에 업로드되지 않은 원음이 남아 있을 수 있습니다.',
    ]
    // dflowSynced 를 모르는 호출부(undefined)에서는 경고를 빼지 않는다 — 빠뜨리는 쪽이 더 위험하다.
    if (dflowSynced !== false) {
      lines.push("· D'Flow에 이미 전송된 회의록은 남습니다. D'Flow에서 직접 처리하세요.")
    }
    lines.push('', '계속할까요?')

    const ok = await confirmDialog(lines.join('\n'), { title: '기밀 구간 절단', kind: 'warning' })
    if (!ok) return

    // expected_bounds 는 "화면에서 본" 경계다(필수 파라미터). 다이얼로그가 열려 있는 동안 다른
    // 클라이언트가 split 하면 서버 현재값과 어긋나 409 가 나고 아무것도 잘리지 않는다 —
    // 겹침 완전성 검사만으로는 그 케이스가 통과해 기밀 절반이 살아남는다.
    const expectedBounds: Record<string, TranscriptBounds> = {}
    for (const r of rows) {
      expectedBounds[String(r.id)] = { started_at_ms: r.started_at_ms, ended_at_ms: r.ended_at_ms }
    }

    setRedacting(true)
    try {
      const result = await redactTranscripts(meetingId, {
        transcript_ids: rows.map((r) => r.id),
        expected_bounds: expectedBounds,
        client_id: clientId,
      })
      removeFinalsInStore(result.deleted_ids)
      setSelected(new Set())
      onRedacted?.(result)
    } catch (err) {
      // 403(비 owner·잠금) / 409(진행 중·동시 변경) / 422(검증) 모두 서버가 한글 메시지를 준다.
      // ky 의 HTTPError 는 body 를 읽어주지 않으므로 직접 파싱한다.
      let message = '기밀 구간 절단에 실패했습니다.'
      const res = (err as { response?: Response }).response
      if (res) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        if (body?.error) message = body.error
      }
      useToastStore.getState().showStatus(message, 5000)
    } finally {
      setRedacting(false)
    }
  }, [meetingId, transcripts, selected, clientId, dflowSynced, onRedacted, removeFinalsInStore])

  function openSplitDialog(transcript: Transcript) {
    // store override(인라인 편집·rename)가 있으면 그 값을 다이얼로그의 기준(expected_content)으로 삼는다 —
    // prop의 transcript는 EditableTranscriptText가 store만 갱신하므로 stale할 수 있다.
    setSplittingTranscript({
      ...transcript,
      content: contentOverrides.get(transcript.id) ?? transcript.content,
      speaker_name: speakerNameOverrides.has(transcript.id)
        ? speakerNameOverrides.get(transcript.id) ?? null
        : transcript.speaker_name,
    })
  }

  function handleSplitSuccess(updated: Transcript, inserted: Transcript) {
    applySplitInStore(updated, inserted)
    setSplittingTranscript(null)
    onSplit?.(updated, inserted)
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
      {canRedact && !readOnly && (
        // 상단 sticky — 루트가 곧 스크롤 컨테이너라(하단 고정 바를 쓰려면 이 구조를 바꿔야 한다)
        // -mx-4 -mt-4 로 루트의 p-4 를 상쇄해 폭 전체를 차지하고 위쪽에 붙게 한다.
        <div className="sticky top-0 z-10 -mx-4 -mt-4 mb-2 px-4 py-2 bg-card border-b flex items-center justify-between">
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={selected.size === transcripts.length && transcripts.length > 0}
              onChange={toggleAll}
              aria-label="전체 선택"
            />
            전체 선택
          </label>
          <div className="flex items-center gap-2">
            {selected.size > 0 && (
              <span className="text-xs text-muted-foreground">{selected.size}개 선택</span>
            )}
            <button
              type="button"
              onClick={handleRedact}
              disabled={selected.size === 0 || redacting}
              className="px-3 py-1.5 text-xs font-medium rounded border border-red-600 text-red-700 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {redacting ? '절단 중...' : '기밀 구간 절단'}
            </button>
          </div>
        </div>
      )}
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
                className={`flex items-start gap-1 p-3 min-h-[44px] rounded cursor-pointer transition-colors ${
                  isHighlighted
                    ? 'bg-accent border-l-4 border-indigo-500'
                    : selected.has(transcript.id)
                      ? 'bg-red-50'
                      : 'hover:bg-muted active:bg-muted'
                }`}
                onClick={() => onSeek(transcript.started_at_ms)}
              >
                {canRedact && !readOnly && (
                  <input
                    type="checkbox"
                    checked={selected.has(transcript.id)}
                    onChange={() => toggleSelect(transcript.id)}
                    // 행 onClick 이 onSeek 이므로 stopPropagation 이 필수다(FullRecord.tsx:142 동일).
                    onClick={(e) => e.stopPropagation()}
                    aria-label="절단 대상 선택"
                    className="mt-1 shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0">
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
                {!readOnly && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      openSplitDialog(transcript)
                    }}
                    aria-label="발언 분할"
                    title="분할"
                    // 터치 기기는 hover가 없어 opacity-0 그룹호버로 숨기면 진입점이 아예 안 보인다 —
                    // 항상 은은하게 보이고 호버/포커스 시에만 강조한다.
                    className="shrink-0 p-1 rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted-foreground/10 focus:text-foreground focus:opacity-100 transition-colors"
                  >
                    <Scissors size={14} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      ))}

      {splittingTranscript && (
        <SplitTranscriptDialog
          meetingId={meetingId}
          transcript={splittingTranscript}
          currentTimeMs={currentTimeMs}
          clientId={clientId}
          onClose={() => setSplittingTranscript(null)}
          onSplit={handleSplitSuccess}
        />
      )}
    </div>
  )
}
