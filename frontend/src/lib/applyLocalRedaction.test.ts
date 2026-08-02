import { describe, it, expect, vi } from 'vitest'
import { applyLocalRedaction } from './applyLocalRedaction'
import type { RedactTranscriptsResponse } from '../api/meetings'

function makeResult(over: Partial<RedactTranscriptsResponse> = {}): RedactTranscriptsResponse {
  return {
    deleted_ids: [2],
    ranges: [{ start_ms: 2500, end_ms: 4500 }],
    total_cut_ms: 2000,
    audio_duration_ms: 8000,
    summaries_destroyed: false,
    chat_markers_updated: 0,
    bookmarks_removed: 0,
    backup_retained: false,
    ...over,
  }
}

function makeDeps() {
  return {
    reloadTranscripts: vi.fn(async () => {}),
    refetchMeeting: vi.fn(),
    markAudioChanged: vi.fn(),
    clearMeetingNotes: vi.fn(),
    notify: vi.fn(),
  }
}

describe('applyLocalRedaction', () => {
  it('markAudioChanged를 정확히 1회 호출한다 ⭐', async () => {
    // 절단한 본인 화면이 옛 오디오(=기밀)를 계속 재생하지 않게 하는 유일한 장치다.
    // MeetingPage는 전사 채널을 구독하지 않으므로 원격 경로가 대신해 주지 않는다.
    const deps = makeDeps()

    await applyLocalRedaction(deps, makeResult())

    expect(deps.markAudioChanged).toHaveBeenCalledTimes(1)
  })

  it('재조회를 1회 한다 (서버 ms 시프트 규칙을 TS로 복제하지 않는다는 결정의 검증)', async () => {
    const deps = makeDeps()

    await applyLocalRedaction(deps, makeResult())

    expect(deps.reloadTranscripts).toHaveBeenCalledTimes(1)
  })

  it('재조회가 실패해도 markAudioChanged는 이미 호출된 상태다', async () => {
    // 전사 목록이 stale한 것보다 기밀 오디오가 계속 재생되는 쪽이 훨씬 나쁘다.
    const deps = makeDeps()
    deps.reloadTranscripts = vi.fn(async () => { throw new Error('network') })

    await expect(applyLocalRedaction(deps, makeResult())).rejects.toThrow('network')

    expect(deps.markAudioChanged).toHaveBeenCalledTimes(1)
  })

  it('summaries_destroyed일 때만 회의록 재생성 안내를 띄운다', async () => {
    const withSummary = makeDeps()
    await applyLocalRedaction(withSummary, makeResult({ summaries_destroyed: true }))
    expect(withSummary.notify).toHaveBeenCalledWith(expect.stringContaining('회의록'), expect.any(Number))

    const without = makeDeps()
    await applyLocalRedaction(without, makeResult({ summaries_destroyed: false }))
    expect(without.notify).not.toHaveBeenCalled()
  })

  it('backup_retained면 백업 잔존 경고도 띄운다', async () => {
    const deps = makeDeps()

    await applyLocalRedaction(deps, makeResult({ backup_retained: true }))

    expect(deps.notify).toHaveBeenCalledWith(expect.stringContaining('백업'), expect.any(Number))
  })

  // ── CRITICAL 회귀: 절단 후 화면의 회의록(BlockNote)이 지워지지 않던 결함 ──
  // AiSummaryPanel은 오직 useTranscriptStore.meetingNotes만 읽고, 그 값은 useMeeting()의
  // summary?.notes_markdown 변화로만 갱신된다. refetch 없이는 summary가 안 바뀌어
  // summaries.destroy_all 이후에도 파기됐어야 할 회의록 텍스트가 화면에 그대로 남는다.
  it('summaries_destroyed면 clearMeetingNotes를 호출한다 — 화면에 파기된 회의록이 남으면 안 된다 ⭐', async () => {
    const deps = makeDeps()

    await applyLocalRedaction(deps, makeResult({ summaries_destroyed: true }))

    expect(deps.clearMeetingNotes).toHaveBeenCalledTimes(1)
  })

  it('summaries_destroyed가 아니면 clearMeetingNotes를 호출하지 않는다(멀쩡한 회의록을 지우면 안 된다)', async () => {
    const deps = makeDeps()

    await applyLocalRedaction(deps, makeResult({ summaries_destroyed: false }))

    expect(deps.clearMeetingNotes).not.toHaveBeenCalled()
  })

  it('refetchMeeting을 호출해 meeting/summary 상태를 갱신한다(transcripts_redacted 배지 등)', async () => {
    const deps = makeDeps()

    await applyLocalRedaction(deps, makeResult())

    expect(deps.refetchMeeting).toHaveBeenCalledTimes(1)
  })

  it('reloadTranscripts가 실패해도 clearMeetingNotes는 이미 호출된 상태다(summaries_destroyed일 때) — 낙관적 클리어가 재조회보다 먼저여야 한다', async () => {
    const deps = makeDeps()
    deps.reloadTranscripts = vi.fn(async () => { throw new Error('network') })

    await expect(
      applyLocalRedaction(deps, makeResult({ summaries_destroyed: true })),
    ).rejects.toThrow('network')

    expect(deps.clearMeetingNotes).toHaveBeenCalledTimes(1)
  })
})
