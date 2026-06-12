import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SpeakerPanel } from './SpeakerPanel'
import { useTranscriptStore } from '../../stores/transcriptStore'

vi.mock('../../api/speakers', () => ({
  getSpeakers: vi.fn().mockResolvedValue([{ id: '화자 1', name: '화자 1' }]),
  renameSpeaker: vi.fn().mockResolvedValue({ id: '화자 1', name: '앨리스' }),
  resetSpeakers: vi.fn().mockResolvedValue(undefined),
}))

describe('SpeakerPanel store 동기화', () => {
  beforeEach(() => {
    useTranscriptStore.getState().reset()
    useTranscriptStore.getState().loadFinals([
      {
        id: 1,
        content: '안녕하세요',
        speaker_label: '화자 1',
        started_at_ms: 0,
        ended_at_ms: 1000,
        sequence_number: 1,
        applied: false,
      },
    ])
  })

  it('rename 성공 시 store finals의 speaker_name을 갱신한다', async () => {
    render(<SpeakerPanel meetingId={1} isRecording={false} />)

    const editBtn = await screen.findByTitle('클릭하여 이름 편집')
    fireEvent.click(editBtn)
    const input = screen.getByPlaceholderText('화자 1')
    fireEvent.change(input, { target: { value: '앨리스' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(useTranscriptStore.getState().finals[0].speaker_name).toBe('앨리스')
    })
  })

  it('초기화 시 store finals의 speaker_name을 모두 제거한다', async () => {
    useTranscriptStore.getState().setSpeakerName('화자 1', '앨리스')
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))

    render(<SpeakerPanel meetingId={1} isRecording={false} />)

    const resetBtn = await screen.findByTitle('화자 DB 초기화')
    fireEvent.click(resetBtn)

    await waitFor(() => {
      expect(useTranscriptStore.getState().finals[0].speaker_name ?? null).toBeNull()
    })
    vi.unstubAllGlobals()
  })
})

describe('collapsible', () => {
  beforeEach(() => {
    useTranscriptStore.getState().reset()
  })

  it('화자 없으면 접힌 summary만 보인다', async () => {
    // getSpeakers resolves with speaker but no finals → visibleSpeakers = []
    render(<SpeakerPanel meetingId={1} isRecording={false} collapsible />)

    // summary element should exist
    const summary = await screen.findByText(/화자 목록/)
    expect(summary).toBeTruthy()

    // details element should be closed (open attribute absent)
    const details = summary.closest('details')
    expect(details).toBeTruthy()
    expect(details!.open).toBe(false)

    // details is closed — content is rendered in DOM but not shown
    // no speaker rows exist because visibleSpeakers is empty
    expect(screen.queryByTitle('클릭하여 이름 편집')).toBeNull()
  })

  it('화자 로드되면 자동으로 펼쳐진다', async () => {
    // provide a final so visibleSpeakers.length > 0
    useTranscriptStore.getState().loadFinals([
      {
        id: 1,
        content: '안녕하세요',
        speaker_label: '화자 1',
        started_at_ms: 0,
        ended_at_ms: 1000,
        sequence_number: 1,
        applied: false,
      },
    ])

    render(<SpeakerPanel meetingId={1} isRecording={false} collapsible />)

    // once speakers load and visibleSpeakers > 0, details should open
    await waitFor(() => {
      const details = document.querySelector('details')
      expect(details!.open).toBe(true)
    })

    // speaker row should be visible
    expect(await screen.findByTitle('클릭하여 이름 편집')).toBeTruthy()
  })

  it('수동으로 접으면 화자가 늘어도 다시 펼치지 않는다', async () => {
    useTranscriptStore.getState().loadFinals([
      {
        id: 1,
        content: '안녕하세요',
        speaker_label: '화자 1',
        started_at_ms: 0,
        ended_at_ms: 1000,
        sequence_number: 1,
        applied: false,
      },
    ])

    render(<SpeakerPanel meetingId={1} isRecording={false} collapsible />)

    // wait for auto-open
    await waitFor(() => {
      const details = document.querySelector('details')
      expect(details!.open).toBe(true)
    })

    // manually close by clicking summary
    const summary = screen.getByText(/화자 목록/)
    fireEvent.click(summary)

    await waitFor(() => {
      const details = document.querySelector('details')
      expect(details!.open).toBe(false)
    })

    // add more finals to trigger the useEffect again
    useTranscriptStore.getState().loadFinals([
      {
        id: 1,
        content: '안녕하세요',
        speaker_label: '화자 1',
        started_at_ms: 0,
        ended_at_ms: 1000,
        sequence_number: 1,
        applied: false,
      },
      {
        id: 2,
        content: '반갑습니다',
        speaker_label: '화자 1',
        started_at_ms: 1000,
        ended_at_ms: 2000,
        sequence_number: 2,
        applied: false,
      },
    ])

    // should remain closed
    await new Promise((r) => setTimeout(r, 50))
    const details = document.querySelector('details')
    expect(details!.open).toBe(false)
  })

  it('collapsible 미지정이면 기존 렌더 그대로', async () => {
    useTranscriptStore.getState().loadFinals([
      {
        id: 1,
        content: '안녕하세요',
        speaker_label: '화자 1',
        started_at_ms: 0,
        ended_at_ms: 1000,
        sequence_number: 1,
        applied: false,
      },
    ])

    render(<SpeakerPanel meetingId={1} isRecording={false} />)

    // no details/summary elements
    expect(await screen.findByTitle('클릭하여 이름 편집')).toBeTruthy()
    expect(document.querySelector('details')).toBeNull()
    expect(screen.queryByText('화자 목록')).toBeTruthy()
  })
})
