import { useEffect, useMemo, useState } from 'react'
import { HTTPError } from 'ky'
import { Dialog } from '../ui/Dialog'
import { splitTranscript, updateTranscriptSpeaker, getTranscripts } from '../../api/meetings'
import type { Transcript } from '../../api/meetings'
import { getSpeakers } from '../../api/speakers'
import type { Speaker } from '../../api/speakers'

interface SplitTranscriptDialogProps {
  meetingId: number
  /** 대상 원행. content/speaker_name은 호출부가 store override를 우선 반영한 최신값을 넘겨야 한다. */
  transcript: Transcript
  /** 오디오 플레이어 현재 재생 위치(ms) — "현재 재생 위치 사용" 버튼이 채택한다. */
  currentTimeMs: number
  /** transcript_updated/split/speaker_updated 브로드캐스트 echo 가드용 클라이언트 id (store.clientId). */
  clientId: string
  onClose: () => void
  onSplit: (updated: Transcript, inserted: Transcript) => void
  /** "화자만 변경" 모드 저장 성공 시 호출. */
  onSpeakerUpdated: (updated: Transcript) => void
}

type DialogMode = 'speaker' | 'split'

const CUSTOM_SPEAKER_VALUE = '__custom__'

interface WordToken {
  text: string
  /** UTF-16(JS 문자열) 인덱스 기준. content.slice와 그대로 호환된다. */
  start: number
  end: number
}

/** 원문을 공백(\s+) 기준 단어 토큰으로 나눈다. 분할 지점 후보는 단어와 단어 사이(경계)뿐이다. */
export function tokenizeWords(content: string): WordToken[] {
  const tokens: WordToken[] = []
  const re = /\S+/g
  let m: RegExpExecArray | null
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(content))) {
    tokens.push({ text: m[0], start: m.index, end: m.index + m[0].length })
  }
  return tokens
}

/** JS(UTF-16) 인덱스를 Ruby String#length와 같은 코드포인트 인덱스로 변환한다.
 *  한글은 BMP 내부라 1:1이지만 서로게이트 쌍(이모지 등)이 앞에 있으면 값이 갈라진다. */
export function utf16ToCodepointIndex(content: string, utf16Index: number): number {
  return Array.from(content.slice(0, utf16Index)).length
}

/** ms를 mm:ss.mmm 문자열로 표시한다. */
export function formatMsPrecise(ms: number): string {
  const clamped = Number.isFinite(ms) && ms > 0 ? Math.round(ms) : 0
  const minutes = Math.floor(clamped / 60000)
  const seconds = Math.floor((clamped % 60000) / 1000)
  const millis = clamped % 1000
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`
}

/** mm:ss.mmm (또는 mm:ss) 문자열을 ms로 파싱한다. 형식이 안 맞으면 null. */
export function parseMsPrecise(text: string): number | null {
  const m = /^(\d{1,3}):([0-5]?\d)(?:\.(\d{1,3}))?$/.exec(text.trim())
  if (!m) return null
  const minutes = Number(m[1])
  const seconds = Number(m[2])
  const millisStr = (m[3] ?? '0').padEnd(3, '0').slice(0, 3)
  return minutes * 60000 + seconds * 1000 + Number(millisStr)
}

/** "현재 재생 위치 사용" 채택 시 (started_at_ms, ended_at_ms) 개방구간으로 클램프한다. */
export function clampSplitMs(ms: number, startedAtMs: number, endedAtMs: number): number {
  const lo = startedAtMs + 1
  const hi = endedAtMs - 1
  if (hi < lo) return lo
  return Math.min(Math.max(Math.round(ms), lo), hi)
}

interface SpeakerSide {
  mode: 'existing' | 'custom'
  label: string
  customLabel: string
  name: string
}

function initialSide(transcript: Transcript): SpeakerSide {
  return {
    mode: 'existing',
    label: transcript.speaker_label,
    customLabel: '',
    name: transcript.speaker_name ?? '',
  }
}

function effectiveLabel(side: SpeakerSide): string {
  return (side.mode === 'custom' ? side.customLabel : side.label).trim()
}

function SpeakerSideFields({
  title,
  speakers,
  side,
  onChange,
}: {
  title: string
  speakers: Speaker[]
  side: SpeakerSide
  onChange: (next: SpeakerSide) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{title}</span>
      <select
        value={side.mode === 'custom' ? CUSTOM_SPEAKER_VALUE : side.label}
        onChange={(e) => {
          const value = e.target.value
          if (value === CUSTOM_SPEAKER_VALUE) {
            onChange({ ...side, mode: 'custom' })
            return
          }
          const found = speakers.find((s) => s.id === value)
          onChange({
            ...side,
            mode: 'existing',
            label: value,
            name: found && found.name !== found.id ? found.name : '',
          })
        }}
        className="w-full rounded-md border border-border px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring bg-background"
      >
        {speakers.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name !== s.id ? s.name : s.id}
          </option>
        ))}
        {!speakers.some((s) => s.id === side.label) && side.mode === 'existing' && (
          <option value={side.label}>{side.label}</option>
        )}
        <option value={CUSTOM_SPEAKER_VALUE}>+ 새 화자 직접 입력</option>
      </select>
      {side.mode === 'custom' && (
        <input
          type="text"
          value={side.customLabel}
          onChange={(e) => onChange({ ...side, customLabel: e.target.value })}
          placeholder="화자 ID (예: SPEAKER_02)"
          className="w-full rounded-md border border-border px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      )}
      <input
        type="text"
        value={side.name}
        onChange={(e) => onChange({ ...side, name: e.target.value })}
        placeholder="표시 이름 (선택)"
        className="w-full rounded-md border border-border px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
      />
    </div>
  )
}

/**
 * 전사 한 행의 화자변경(분할 없음) 또는 발언 분할을 수행하는 모달. 기본 모드는 화자만 변경.
 * 분할 모드의 텍스트 분할점은 단어 경계 클릭으로만 고른다(캐럿 미사용 —
 * 모바일/Tauri WebView에서 readOnly textarea의 selectionStart가 플랫폼 의존적이기 때문.
 * 설계: docs/superpowers/specs/2026-07-30-transcript-split-design.md).
 */
export function SplitTranscriptDialog({
  meetingId,
  transcript,
  currentTimeMs,
  clientId,
  onClose,
  onSplit,
  onSpeakerUpdated,
}: SplitTranscriptDialogProps) {
  // 기본값은 "화자만 변경" — 분할보다 훨씬 흔한 조작이라 진입 클릭 한 번으로 끝나야 한다.
  const [mode, setMode] = useState<DialogMode>('speaker')

  // expected_content로 보낼 원문. 409로 어긋났음이 확인되면 최신값으로 리셋한다.
  const [workingContent, setWorkingContent] = useState(transcript.content)
  const [selectedEnd, setSelectedEnd] = useState<number | null>(null)

  const [speakers, setSpeakers] = useState<Speaker[]>([])
  const [speakerOnly, setSpeakerOnly] = useState<SpeakerSide>(() => initialSide(transcript))
  const [first, setFirst] = useState<SpeakerSide>(() => initialSide(transcript))
  const [second, setSecond] = useState<SpeakerSide>(() => initialSide(transcript))

  const [splitMsText, setSplitMsText] = useState('')
  const [splitMs, setSplitMs] = useState<number | null>(null)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 409 후 최신 내용 재조회(getTranscripts)까지 실패하면(또는 행을 못 찾으면) expected_content를
  // 갱신할 방법이 없다 — 그대로 재저장하면 옛 값이 다시 나가 반드시 또 409(무한 루프). 이 경우
  // 저장을 아예 막고 창을 닫았다 다시 열도록 안내한다.
  const [refetchFailed, setRefetchFailed] = useState(false)

  useEffect(() => {
    getSpeakers(meetingId).then(setSpeakers).catch(() => {})
  }, [meetingId])

  const tokens = useMemo(() => tokenizeWords(workingContent), [workingContent])

  const prefixText = selectedEnd != null ? workingContent.slice(0, selectedEnd).trim() : ''
  const suffixText = selectedEnd != null ? workingContent.slice(selectedEnd).trim() : ''

  const msValid = splitMs != null && splitMs > transcript.started_at_ms && splitMs < transcript.ended_at_ms
  const indexValid = selectedEnd != null && prefixText.length > 0 && suffixText.length > 0
  const firstLabel = effectiveLabel(first)
  const secondLabel = effectiveLabel(second)
  const speakersValid = firstLabel.length > 0 && secondLabel.length > 0
  const canSaveSplit = msValid && indexValid && speakersValid && !saving && !refetchFailed

  const speakerOnlyLabel = effectiveLabel(speakerOnly)
  const canSaveSpeaker = speakerOnlyLabel.length > 0 && !saving

  function handleBoundaryClick(end: number) {
    setSelectedEnd(end)
  }

  function handleUseCurrentPosition() {
    const clamped = clampSplitMs(currentTimeMs, transcript.started_at_ms, transcript.ended_at_ms)
    setSplitMs(clamped)
    setSplitMsText(formatMsPrecise(clamped))
  }

  function handleMsTextChange(text: string) {
    setSplitMsText(text)
    setSplitMs(parseMsPrecise(text))
  }

  async function handleSpeakerSave() {
    if (!canSaveSpeaker) return
    setSaving(true)
    setError(null)
    try {
      const name = speakerOnly.name.trim()
      const result = await updateTranscriptSpeaker(meetingId, transcript.id, {
        speaker_label: speakerOnlyLabel,
        speaker_name: name ? name : null,
        client_id: clientId,
      })
      onSpeakerUpdated(result)
    } catch (err) {
      if (err instanceof HTTPError) {
        const body = (await err.response.json().catch(() => ({}))) as { error?: string }
        setError(body.error ?? '화자 변경 중 오류가 발생했습니다.')
      } else {
        setError('화자 변경 중 오류가 발생했습니다.')
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleSplitSave() {
    if (!canSaveSplit || selectedEnd == null || splitMs == null) return
    setSaving(true)
    setError(null)
    try {
      const result = await splitTranscript(meetingId, transcript.id, {
        split_ms: splitMs,
        split_index: utf16ToCodepointIndex(workingContent, selectedEnd),
        expected_content: workingContent,
        first: { speaker_label: firstLabel, speaker_name: first.name.trim() ? first.name.trim() : null },
        second: { speaker_label: secondLabel, speaker_name: second.name.trim() ? second.name.trim() : null },
        client_id: clientId,
      })
      onSplit(result.updated, result.inserted)
    } catch (err) {
      if (err instanceof HTTPError && err.response.status === 409) {
        // 다이얼로그를 최신 내용으로 리셋 — split 응답 자체엔 최신 content가 없으므로 재조회한다.
        // getTranscripts는 내부적으로 실패를 삼키고 빈 배열을 반환하므로(api/meetings/transcripts.ts),
        // "재조회 실패"와 "행이 실제로 없음"을 여기서 구분할 수 없다 — 둘 다 latestRow를 못 찾는
        // 형태로 나타나므로 같은 분기(재저장 불가 안내)로 처리한다. .catch는 향후 구현이 바뀌어
        // getTranscripts가 진짜로 throw하게 되더라도 안전하도록 방어적으로 남겨둔다.
        const latest = await getTranscripts(meetingId).catch(() => [])
        const latestRow = latest.find((t) => t.id === transcript.id)
        if (latestRow) {
          setError('다른 곳에서 이 발언이 수정되었습니다. 다시 시도하세요.')
          setWorkingContent(latestRow.content)
          setSelectedEnd(null)
        } else {
          // 최신 내용을 못 가져와 expected_content를 고칠 방법이 없다 — 그대로 재저장하면
          // 옛 값이 다시 나가 반드시 또 409(무한 루프)다. 저장을 막고 재진입을 안내한다.
          setError('최신 내용을 불러오지 못했습니다. 창을 닫고 다시 열어주세요.')
          setRefetchFailed(true)
        }
      } else if (err instanceof HTTPError) {
        const body = (await err.response.json().catch(() => ({}))) as { error?: string }
        setError(body.error ?? '분할 처리 중 오류가 발생했습니다.')
      } else {
        setError('분할 처리 중 오류가 발생했습니다.')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog onClose={onClose} ariaLabel="화자변경/발언분할" className="w-full max-w-lg rounded-xl bg-card p-6 shadow-2xl border border-border max-h-[90vh] overflow-y-auto">
      <h2 className="text-base font-semibold text-foreground mb-1">화자변경/발언분할</h2>
      <p className="text-xs text-muted-foreground mb-4">
        {mode === 'speaker'
          ? '이 행의 화자만 바꿉니다. 텍스트는 그대로 유지됩니다.'
          : '한 행에 섞인 두 사람의 발언을 나눌 지점을 단어 사이에서 고르세요.'}
      </p>

      <div role="tablist" className="mb-4 inline-flex rounded-md border border-border p-0.5 bg-muted/30">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'speaker'}
          onClick={() => setMode('speaker')}
          className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
            mode === 'speaker' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          화자만 변경
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'split'}
          onClick={() => setMode('split')}
          className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
            mode === 'split' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          발언 분할
        </button>
      </div>

      {mode === 'speaker' && (
        <div className="mb-4">
          <SpeakerSideFields title="화자" speakers={speakers} side={speakerOnly} onChange={setSpeakerOnly} />
        </div>
      )}

      {mode === 'split' && (
        <>
          <div className="mb-4">
            <span className="block text-xs font-medium text-muted-foreground mb-1">텍스트 분할 지점</span>
            <div className="rounded-md border border-border bg-muted/30 p-3 text-sm leading-relaxed whitespace-pre-wrap">
              {tokens.length === 0 && (
                <span className="text-muted-foreground">분할 가능한 지점이 없습니다 (단어가 하나뿐입니다).</span>
              )}
              {tokens.map((tok, i) => (
                <span key={i}>
                  {workingContent.slice(i === 0 ? 0 : tokens[i - 1].end, tok.start)}
                  <span>{tok.text}</span>
                  {i < tokens.length - 1 && (
                    <button
                      type="button"
                      onClick={() => handleBoundaryClick(tok.end)}
                      aria-label={`분할 지점: "${tok.text}" 뒤`}
                      aria-pressed={selectedEnd === tok.end}
                      className={`inline-block w-2 mx-0.5 rounded-sm align-middle ${
                        selectedEnd === tok.end
                          ? 'bg-blue-500'
                          : 'bg-border hover:bg-blue-300'
                      }`}
                      style={{ height: '1em' }}
                    />
                  )}
                </span>
              ))}
            </div>
          </div>

          <div className="mb-4">
            <span className="block text-xs font-medium text-muted-foreground mb-1">오디오 분할 위치</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleUseCurrentPosition}
                className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted transition-colors shrink-0"
              >
                현재 재생 위치 사용
              </button>
              <input
                type="text"
                value={splitMsText}
                onChange={(e) => handleMsTextChange(e.target.value)}
                placeholder="mm:ss.mmm"
                className="flex-1 rounded-md border border-border px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            {splitMsText && !msValid && (
              <p className="mt-1 text-xs text-red-500">
                {formatMsPrecise(transcript.started_at_ms)} ~ {formatMsPrecise(transcript.ended_at_ms)} 범위(양 끝 제외) 안이어야 합니다.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <SpeakerSideFields title="첫 번째 조각 화자" speakers={speakers} side={first} onChange={setFirst} />
            <SpeakerSideFields title="두 번째 조각 화자" speakers={speakers} side={second} onChange={setSecond} />
          </div>

          {indexValid && msValid && (
            <div className="mb-4">
              <span className="block text-xs font-medium text-muted-foreground mb-1">미리보기</span>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-md border border-border p-2">
                  <div className="text-muted-foreground mb-1">
                    {formatMsPrecise(transcript.started_at_ms)} ~ {formatMsPrecise(splitMs ?? 0)}
                  </div>
                  <div className="text-foreground whitespace-pre-wrap">{prefixText}</div>
                </div>
                <div className="rounded-md border border-border p-2">
                  <div className="text-muted-foreground mb-1">
                    {formatMsPrecise(splitMs ?? 0)} ~ {formatMsPrecise(transcript.ended_at_ms)}
                  </div>
                  <div className="text-foreground whitespace-pre-wrap">{suffixText}</div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {error && <p className="mb-3 text-sm text-red-500">{error}</p>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
        >
          취소
        </button>
        {mode === 'speaker' ? (
          <button
            type="button"
            onClick={handleSpeakerSave}
            disabled={!canSaveSpeaker}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saving ? '저장 중...' : '변경 저장'}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSplitSave}
            disabled={!canSaveSplit}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saving ? '저장 중...' : '분할 저장'}
          </button>
        )}
      </div>
    </Dialog>
  )
}
