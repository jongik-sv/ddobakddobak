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
