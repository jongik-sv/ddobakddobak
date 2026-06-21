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

describe('화자 배지 클릭 → 발화 점프', () => {
  // 두 발화(화자 1): 0ms, 5000ms
  const TWO_UTTS = [
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
      started_at_ms: 5000,
      ended_at_ms: 6000,
      sequence_number: 2,
      applied: false,
    },
  ]

  beforeEach(() => {
    useTranscriptStore.getState().reset()
  })

  it('onSpeakerSeek 미전달이면 배지는 비대화형 <span> (클릭 콜백 없음)', async () => {
    useTranscriptStore.getState().loadFinals(TWO_UTTS)
    render(<SpeakerPanel meetingId={1} isRecording={false} />)

    // 배지 button("이 화자 발화로 이동")이 없어야 한다 — span만 존재
    await screen.findByTitle('클릭하여 이름 편집')
    expect(screen.queryByTitle('이 화자 발화로 이동')).toBeNull()
  })

  it('콜드스타트 클릭 → 첫 발화 ms로 onSpeakerSeek 호출', async () => {
    useTranscriptStore.getState().loadFinals(TWO_UTTS)
    const onSpeakerSeek = vi.fn()
    render(
      <SpeakerPanel
        meetingId={1}
        isRecording={false}
        currentTimeMs={0}
        isPlaying={false}
        onSpeakerSeek={onSpeakerSeek}
      />,
    )

    const badge = await screen.findByTitle('이 화자 발화로 이동')
    fireEvent.click(badge)
    expect(onSpeakerSeek).toHaveBeenCalledWith(0)
  })

  it('재생중·현재 위치가 발화1·발화2 사이 → 발화2 ms로 호출', async () => {
    useTranscriptStore.getState().loadFinals(TWO_UTTS)
    const onSpeakerSeek = vi.fn()
    render(
      <SpeakerPanel
        meetingId={1}
        isRecording={false}
        currentTimeMs={3000}
        isPlaying={true}
        onSpeakerSeek={onSpeakerSeek}
      />,
    )

    const badge = await screen.findByTitle('이 화자 발화로 이동')
    fireEvent.click(badge)
    expect(onSpeakerSeek).toHaveBeenCalledWith(5000)
  })

  it('반복 클릭 시 재생 위치(currentTimeMs)가 앞으로 갈수록 다음 발화로 진행', async () => {
    const THREE_UTTS = [
      ...TWO_UTTS,
      {
        id: 3,
        content: '잘 부탁드립니다',
        speaker_label: '화자 1',
        started_at_ms: 10000,
        ended_at_ms: 11000,
        sequence_number: 3,
        applied: false,
      },
    ]
    useTranscriptStore.getState().loadFinals(THREE_UTTS)
    const onSpeakerSeek = vi.fn()

    // 콜드스타트: currentTimeMs=0, 정지
    const { rerender } = render(
      <SpeakerPanel
        meetingId={1}
        isRecording={false}
        currentTimeMs={0}
        isPlaying={false}
        onSpeakerSeek={onSpeakerSeek}
      />,
    )

    // 1차 클릭 → 첫 발화(0)
    fireEvent.click(await screen.findByTitle('이 화자 발화로 이동'))
    expect(onSpeakerSeek.mock.calls[0][0]).toBe(0)

    // 실제 재생이 발화1 위치로 이동했다고 가정하고 currentTimeMs를 0 이후로 rerender
    // (onSpeakerSeek/isPlaying을 반드시 다시 전달 — rerender는 props 전체 교체)
    rerender(
      <SpeakerPanel
        meetingId={1}
        isRecording={false}
        currentTimeMs={1}
        isPlaying={true}
        onSpeakerSeek={onSpeakerSeek}
      />,
    )

    // 2차 클릭 → 발화2(5000)
    fireEvent.click(screen.getByTitle('이 화자 발화로 이동'))
    expect(onSpeakerSeek.mock.calls[1][0]).toBe(5000)

    // 재생이 발화2를 지나 6000ms까지 진행했다고 rerender.
    // (lastJump=5000만 본다면 다음은 5000초과 첫 발화로 또 5000을 못 넘기지만,
    //  실제 재생위치 6000을 base로 써야 발화3으로 건너뛴다 — playback-driven walk 증명)
    rerender(
      <SpeakerPanel
        meetingId={1}
        isRecording={false}
        currentTimeMs={6000}
        isPlaying={true}
        onSpeakerSeek={onSpeakerSeek}
      />,
    )

    // 3차 클릭 → 발화3(10000), 발화2(5000) 건너뜀
    fireEvent.click(screen.getByTitle('이 화자 발화로 이동'))
    expect(onSpeakerSeek.mock.calls[2][0]).toBe(10000)
  })

  it('마지막 발화 이후 클릭 → 첫 발화로 wrap', async () => {
    useTranscriptStore.getState().loadFinals(TWO_UTTS)
    const onSpeakerSeek = vi.fn()
    render(
      <SpeakerPanel
        meetingId={1}
        isRecording={false}
        currentTimeMs={99999}
        isPlaying={true}
        onSpeakerSeek={onSpeakerSeek}
      />,
    )

    fireEvent.click(await screen.findByTitle('이 화자 발화로 이동'))
    expect(onSpeakerSeek).toHaveBeenCalledWith(0)
  })
})
