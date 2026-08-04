import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const confirmDialog = vi.fn<(...args: unknown[]) => Promise<boolean>>()
vi.mock('../../lib/confirmDialog', () => ({
  confirmDialog: (...args: unknown[]) => confirmDialog(...args),
}))

const redactTranscripts = vi.fn()
vi.mock('../../api/meetings', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>)
  return { ...actual, redactTranscripts: (...args: unknown[]) => redactTranscripts(...args), splitTranscript: vi.fn() }
})

vi.mock('../../api/speakers', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>)
  return { ...actual, getSpeakers: vi.fn(async () => []) }
})

import { TranscriptPanel } from './TranscriptPanel'
import { useTranscriptStore } from '../../stores/transcriptStore'

const transcripts = [
  { id: 1, speaker_label: 'SPEAKER_00', content: '앞부분 발언', started_at_ms: 0, ended_at_ms: 2000, sequence_number: 1 },
  { id: 2, speaker_label: 'SPEAKER_01', content: '기밀 발언', started_at_ms: 3000, ended_at_ms: 4000, sequence_number: 2 },
]

const okResult = {
  deleted_ids: [2],
  ranges: [{ start_ms: 2500, end_ms: 4000 }],
  total_cut_ms: 1500,
  audio_duration_ms: 8500,
  summaries_destroyed: true,
  chat_markers_updated: 0,
  bookmarks_removed: 0,
  backup_retained: false,
}

function renderPanel(props: Record<string, unknown> = {}) {
  return render(
    <TranscriptPanel
      meetingId={1}
      transcripts={transcripts}
      currentTimeMs={0}
      onSeek={vi.fn()}
      {...props}
    />
  )
}

describe('TranscriptPanel 기밀 구간 절단', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    confirmDialog.mockResolvedValue(true)
    redactTranscripts.mockResolvedValue(okResult)
    useTranscriptStore.getState().reset()
  })

  it('canRedact가 아니면 체크박스도 절단 버튼도 렌더되지 않는다', () => {
    renderPanel()
    expect(screen.queryByRole('button', { name: '기밀 구간 절단' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('절단 대상 선택')).not.toBeInTheDocument()
  })

  it('readOnly면 canRedact여도 노출되지 않는다', () => {
    renderPanel({ canRedact: true, readOnly: true })
    expect(screen.queryByRole('button', { name: '기밀 구간 절단' })).not.toBeInTheDocument()
  })

  it('canRedact면 버튼이 보이고, 선택이 없으면 비활성이다', () => {
    renderPanel({ canRedact: true })
    expect(screen.getByRole('button', { name: '기밀 구간 절단' })).toBeDisabled()
  })

  it('체크박스 클릭은 행의 onSeek를 발화시키지 않는다 (stopPropagation)', async () => {
    const onSeek = vi.fn()
    renderPanel({ canRedact: true, onSeek })

    await userEvent.click(screen.getAllByLabelText('절단 대상 선택')[1])

    expect(onSeek).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '기밀 구간 절단' })).toBeEnabled()
  })

  it('전체 선택 체크박스는 존재하지 않는다 (개별 행 체크박스는 남아있다)', () => {
    renderPanel({ canRedact: true })

    expect(screen.queryByLabelText('전체 선택')).not.toBeInTheDocument()
    expect(screen.getAllByLabelText('절단 대상 선택')).toHaveLength(2)
  })

  it('confirmDialog를 취소하면 API를 호출하지 않는다', async () => {
    confirmDialog.mockResolvedValue(false)
    renderPanel({ canRedact: true })

    await userEvent.click(screen.getAllByLabelText('절단 대상 선택')[1])
    await userEvent.click(screen.getByRole('button', { name: '기밀 구간 절단' }))

    await waitFor(() => expect(confirmDialog).toHaveBeenCalled())
    expect(redactTranscripts).not.toHaveBeenCalled()
  })

  it('window.confirm이 아니라 confirmDialog 헬퍼를 쓴다', async () => {
    const nativeConfirm = vi.spyOn(window, 'confirm')
    renderPanel({ canRedact: true })

    await userEvent.click(screen.getAllByLabelText('절단 대상 선택')[1])
    await userEvent.click(screen.getByRole('button', { name: '기밀 구간 절단' }))

    await waitFor(() => expect(confirmDialog).toHaveBeenCalled())
    expect(nativeConfirm).not.toHaveBeenCalled()
  })

  it('확인 문구에 비가역·오디오 재인코딩·회의록 삭제·챗 잔존·데스크톱·후속 회의 시드 사본 경고가 모두 들어간다', async () => {
    renderPanel({ canRedact: true })

    await userEvent.click(screen.getAllByLabelText('절단 대상 선택')[1])
    await userEvent.click(screen.getByRole('button', { name: '기밀 구간 절단' }))

    await waitFor(() => expect(confirmDialog).toHaveBeenCalled())
    const message = String(confirmDialog.mock.calls[0][0])
    expect(message).toContain('되돌릴 수 없습니다')
    expect(message).toContain('재인코딩')
    expect(message).toContain('회의록')
    expect(message).toContain('내 챗 기록에 인용된 내용은 남습니다')
    expect(message).toContain('직접 편집한 회의록도 함께 삭제되며 복구되지 않습니다')
    expect(message).toContain('데스크톱')
    // 3차 감사 발견: Meeting#seed_summary_from_previous!가 이전 회의의 회의록을 후속 회의
    // summaries.notes_markdown에 그대로 복사한다. 그 사본은 파기하지 않기로 결정했으므로
    // (설계 §확인 다이얼로그) 고지 의무만 남는다 — 후속 회의 존재를 판정할 API 필드가 없어
    // 무조건 표시한다.
    expect(message).toContain('이전 회의로 참고한 다른 회의')
    expect(message).toContain('00:03') // 선택 구간 시작
  })

  it('한 시간이 넘는 구간을 시:분:초로 표시한다 (MM:SS 고정이면 "90:00"이 된다)', async () => {
    const long = [
      { id: 1, speaker_label: 'S0', content: '앞', started_at_ms: 0, ended_at_ms: 1000, sequence_number: 1 },
      { id: 2, speaker_label: 'S1', content: '긴 기밀', started_at_ms: 3_600_000, ended_at_ms: 5_400_000, sequence_number: 2 },
    ]
    renderPanel({ canRedact: true, transcripts: long })

    await userEvent.click(screen.getAllByLabelText('절단 대상 선택')[1])
    await userEvent.click(screen.getByRole('button', { name: '기밀 구간 절단' }))

    await waitFor(() => expect(confirmDialog).toHaveBeenCalled())
    expect(String(confirmDialog.mock.calls[0][0])).toContain('1:00:00')
  })

  it("dflowSynced={false}면 D'Flow 경고를 넣지 않는다", async () => {
    renderPanel({ canRedact: true, dflowSynced: false })

    await userEvent.click(screen.getAllByLabelText('절단 대상 선택')[1])
    await userEvent.click(screen.getByRole('button', { name: '기밀 구간 절단' }))

    await waitFor(() => expect(confirmDialog).toHaveBeenCalled())
    expect(String(confirmDialog.mock.calls[0][0])).not.toContain("D'Flow")
  })

  it('승인하면 선택 id와 화면에서 본 expected_bounds를 함께 보낸다', async () => {
    renderPanel({ canRedact: true })

    await userEvent.click(screen.getAllByLabelText('절단 대상 선택')[1])
    await userEvent.click(screen.getByRole('button', { name: '기밀 구간 절단' }))

    await waitFor(() => expect(redactTranscripts).toHaveBeenCalled())
    expect(redactTranscripts.mock.calls[0][0]).toBe(1)
    const params = redactTranscripts.mock.calls[0][1]
    expect(params.transcript_ids).toEqual([2])
    expect(params.expected_bounds).toEqual({ '2': { started_at_ms: 3000, ended_at_ms: 4000 } })
  })

  it('성공하면 store에서 행을 제거하고 onRedacted를 호출한다', async () => {
    useTranscriptStore.getState().loadFinals([
      { id: 1, content: '앞부분 발언', speaker_label: 'SPEAKER_00', started_at_ms: 0, ended_at_ms: 2000, sequence_number: 1, applied: true },
      { id: 2, content: '기밀 발언', speaker_label: 'SPEAKER_01', started_at_ms: 3000, ended_at_ms: 4000, sequence_number: 2, applied: true },
    ])
    const onRedacted = vi.fn()
    renderPanel({ canRedact: true, onRedacted })

    await userEvent.click(screen.getAllByLabelText('절단 대상 선택')[1])
    await userEvent.click(screen.getByRole('button', { name: '기밀 구간 절단' }))

    await waitFor(() => expect(onRedacted).toHaveBeenCalledWith(okResult))
    expect(useTranscriptStore.getState().finals.map((f) => f.id)).toEqual([1])
  })

  it('transcripts prop에서 사라진 행의 선택은 정리된다 (stale id 전송 방지)', async () => {
    const { rerender } = render(
      <TranscriptPanel meetingId={1} transcripts={transcripts} currentTimeMs={0} onSeek={vi.fn()} canRedact />
    )

    await userEvent.click(screen.getAllByLabelText('절단 대상 선택')[1])
    expect(screen.getByText('1개 선택')).toBeInTheDocument()

    rerender(
      <TranscriptPanel meetingId={1} transcripts={[transcripts[0]]} currentTimeMs={0} onSeek={vi.fn()} canRedact />
    )

    expect(screen.queryByText(/개 선택/)).not.toBeInTheDocument()
  })
})
