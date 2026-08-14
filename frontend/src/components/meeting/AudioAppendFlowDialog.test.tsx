import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AudioAppendFlowDialog } from './AudioAppendFlowDialog'
import { mergeAudioFiles } from '../../lib/audioMerge'
import { promoteAudio, regenerateStt } from '../../api/meetings'

vi.mock('../../lib/audioMerge', async () => {
  const actual = await vi.importActual<typeof import('../../lib/audioMerge')>('../../lib/audioMerge')
  return {
    ...actual,
    mergeAudioFiles: vi.fn(),
  }
})

vi.mock('../../api/meetings', () => ({
  promoteAudio: vi.fn(),
  regenerateStt: vi.fn(),
}))

function makeFile(name: string, size = 1024): File {
  return new File([new Uint8Array(size)], name, { type: 'audio/mpeg' })
}

const mergedFile = makeFile('merged.wav')

describe('AudioAppendFlowDialog', () => {
  beforeEach(() => {
    vi.mocked(mergeAudioFiles).mockReset().mockResolvedValue(mergedFile)
    vi.mocked(promoteAudio).mockReset().mockResolvedValue(undefined)
    vi.mocked(regenerateStt).mockReset().mockResolvedValue({} as never)
  })

  it('open=false면 아무것도 렌더하지 않는다', () => {
    const { container } = render(
      <AudioAppendFlowDialog open={false} meetingId={1} files={[makeFile('a.mp3')]} onClose={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('파일이 1개면 순서 선택 리스트(AudioFileOrderList)를 생략한다', () => {
    render(<AudioAppendFlowDialog open meetingId={1} files={[makeFile('solo.mp3')]} onClose={vi.fn()} />)
    expect(screen.getByText(/solo\.mp3/)).toBeInTheDocument()
    // 순서 이동 버튼(리스트 전용 UI)이 없어야 한다
    expect(screen.queryByLabelText(/위로 이동/)).not.toBeInTheDocument()
  })

  it('파일이 2개 이상이면 순서 선택 리스트를 보여준다', () => {
    render(
      <AudioAppendFlowDialog
        open
        meetingId={1}
        files={[makeFile('b.mp3'), makeFile('a.mp3')]}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getAllByLabelText(/위로 이동/).length).toBeGreaterThan(0)
  })

  it('"병합 시작" 클릭 시 모달→배너로 전환하고 onMergeStarted를 호출하며 mergeAudioFiles·promoteAudio를 순서대로 호출한다', async () => {
    const onMergeStarted = vi.fn()
    render(
      <AudioAppendFlowDialog
        open
        meetingId={42}
        files={[makeFile('solo.mp3')]}
        onClose={vi.fn()}
        onMergeStarted={onMergeStarted}
      />,
    )

    fireEvent.click(screen.getByText('병합 시작'))

    expect(onMergeStarted).toHaveBeenCalledTimes(1)
    // 모달이 배너로 전환됨
    expect(screen.getByTestId('audio-append-banner')).toBeInTheDocument()

    await waitFor(() => expect(screen.getByText(/재전사를 실행할까요/)).toBeInTheDocument())

    expect(mergeAudioFiles).toHaveBeenCalledTimes(1)
    expect(promoteAudio).toHaveBeenCalledWith(42, mergedFile)
  })

  it('재전사 확인에서 "예" 선택 시 regenerateStt를 호출하고 onCompleted·onClose를 호출한다', async () => {
    const onCompleted = vi.fn()
    const onClose = vi.fn()
    render(
      <AudioAppendFlowDialog
        open
        meetingId={7}
        files={[makeFile('solo.mp3')]}
        onClose={onClose}
        onCompleted={onCompleted}
      />,
    )

    fireEvent.click(screen.getByText('병합 시작'))
    await waitFor(() => expect(screen.getByText('예, 재전사')).toBeInTheDocument())
    fireEvent.click(screen.getByText('예, 재전사'))

    await waitFor(() => expect(regenerateStt).toHaveBeenCalledWith(7))
    await waitFor(() => expect(onCompleted).toHaveBeenCalledTimes(1))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('재전사 확인에서 "아니오" 선택 시 regenerateStt 없이 onCompleted·onClose를 호출한다', async () => {
    const onCompleted = vi.fn()
    const onClose = vi.fn()
    render(
      <AudioAppendFlowDialog
        open
        meetingId={7}
        files={[makeFile('solo.mp3')]}
        onClose={onClose}
        onCompleted={onCompleted}
      />,
    )

    fireEvent.click(screen.getByText('병합 시작'))
    await waitFor(() => expect(screen.getByText('아니오')).toBeInTheDocument())
    fireEvent.click(screen.getByText('아니오'))

    expect(regenerateStt).not.toHaveBeenCalled()
    expect(onCompleted).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('병합 실패 시 배너에 에러+재시도 버튼을 보여준다', async () => {
    vi.mocked(mergeAudioFiles).mockRejectedValueOnce(new Error('디코딩 실패'))
    render(<AudioAppendFlowDialog open meetingId={1} files={[makeFile('bad.mp3')]} onClose={vi.fn()} />)

    fireEvent.click(screen.getByText('병합 시작'))

    await waitFor(() => expect(screen.getByText('디코딩 실패')).toBeInTheDocument())
    expect(screen.getByText('재시도')).toBeInTheDocument()

    // 재시도 시 성공 케이스로 회복
    vi.mocked(mergeAudioFiles).mockResolvedValueOnce(mergedFile)
    fireEvent.click(screen.getByText('재시도'))
    await waitFor(() => expect(screen.getByText(/재전사를 실행할까요/)).toBeInTheDocument())
  })

  it('취소 버튼 클릭 시 onClose를 호출한다', () => {
    const onClose = vi.fn()
    render(<AudioAppendFlowDialog open meetingId={1} files={[makeFile('a.mp3')]} onClose={onClose} />)
    fireEvent.click(screen.getByText('취소'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  // 🔴 findings #1: open false→true 재오픈 시 이전 phase/banner/error가 남아있으면 안 된다.
  describe('재오픈 시 상태 리셋', () => {
    it('배너/에러 상태까지 진행한 뒤 닫혔다가 새 파일로 재오픈하면 select 단계로 리셋된다', async () => {
      const onClose = vi.fn()
      const { rerender } = render(
        <AudioAppendFlowDialog open meetingId={1} files={[makeFile('first.mp3')]} onClose={onClose} />,
      )

      // 실패 → 배너 + 에러 상태로 진입시킨다.
      vi.mocked(mergeAudioFiles).mockRejectedValueOnce(new Error('디코딩 실패'))
      fireEvent.click(screen.getByText('병합 시작'))
      await waitFor(() => expect(screen.getByText('디코딩 실패')).toBeInTheDocument())
      expect(screen.getByTestId('audio-append-banner')).toBeInTheDocument()

      // 닫힘
      rerender(
        <AudioAppendFlowDialog open={false} meetingId={1} files={[makeFile('first.mp3')]} onClose={onClose} />,
      )

      // 새 파일로 재오픈
      rerender(
        <AudioAppendFlowDialog open meetingId={1} files={[makeFile('second.mp3')]} onClose={onClose} />,
      )

      // 배너/에러가 아니라 select 단계(모달)로 돌아와야 하고, 새 파일명이 보여야 한다.
      expect(screen.queryByTestId('audio-append-banner')).not.toBeInTheDocument()
      expect(screen.getByText('병합 시작')).toBeInTheDocument()
      expect(screen.getByText(/second\.mp3/)).toBeInTheDocument()
      expect(screen.queryByText(/first\.mp3/)).not.toBeInTheDocument()
      expect(screen.queryByText('디코딩 실패')).not.toBeInTheDocument()
    })

    it('배너(진행중) 상태에서 files prop만 바뀌어도 진행 중인 플로우를 리셋하지 않는다', async () => {
      const { rerender } = render(
        <AudioAppendFlowDialog open meetingId={1} files={[makeFile('a.mp3')]} onClose={vi.fn()} />,
      )

      fireEvent.click(screen.getByText('병합 시작'))
      expect(screen.getByTestId('audio-append-banner')).toBeInTheDocument()
      await waitFor(() => expect(screen.getByText(/재전사를 실행할까요/)).toBeInTheDocument())

      // open은 그대로 true, files prop만 바뀌는 상황(예: 부모 리렌더) — 진행 중 배너가 유지돼야 한다.
      rerender(<AudioAppendFlowDialog open meetingId={1} files={[makeFile('other.mp3')]} onClose={vi.fn()} />)

      expect(screen.getByText(/재전사를 실행할까요/)).toBeInTheDocument()
    })
  })
})
