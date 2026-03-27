import { describe, it, expect, beforeEach } from 'vitest'
import { useTranscriptStore } from './transcriptStore'

describe('transcriptStore', () => {
  beforeEach(() => {
    useTranscriptStore.getState().reset()
  })

  it('초기 상태 확인', () => {
    const state = useTranscriptStore.getState()
    expect(state.partial).toBeNull()
    expect(state.finals).toEqual([])
    expect(state.meetingNotes).toBeNull()
    expect(state.currentSpeaker).toBeNull()
  })

  it('setPartial: partial 텍스트 업데이트', () => {
    useTranscriptStore.getState().setPartial({
      content: '안녕하세요',
      speaker_label: 'SPEAKER_00',
      started_at_ms: 1000,
    })
    expect(useTranscriptStore.getState().partial?.content).toBe('안녕하세요')
    expect(useTranscriptStore.getState().partial?.speaker_label).toBe('SPEAKER_00')
  })

  it('addFinal: finals 배열에 추가', () => {
    const finalData = {
      id: 1,
      content: '반갑습니다',
      speaker_label: 'SPEAKER_00',
      started_at_ms: 0,
      ended_at_ms: 3000,
      sequence_number: 1,
      applied: false,
    }
    useTranscriptStore.getState().addFinal(finalData)
    expect(useTranscriptStore.getState().finals).toHaveLength(1)
    expect(useTranscriptStore.getState().finals[0].content).toBe('반갑습니다')
  })

  it('addFinal 후 partial 초기화', () => {
    useTranscriptStore.getState().setPartial({
      content: '반갑습니다',
      speaker_label: 'SPEAKER_00',
      started_at_ms: 0,
    })
    useTranscriptStore.getState().addFinal({
      id: 1,
      content: '반갑습니다',
      speaker_label: 'SPEAKER_00',
      started_at_ms: 0,
      ended_at_ms: 3000,
      sequence_number: 1,
      applied: false,
    })
    expect(useTranscriptStore.getState().partial).toBeNull()
  })

  it('setSpeaker: currentSpeaker 업데이트', () => {
    useTranscriptStore.getState().setSpeaker({
      speaker_label: 'SPEAKER_01',
      started_at_ms: 5000,
    })
    expect(useTranscriptStore.getState().currentSpeaker).toBe('SPEAKER_01')
  })

  it('setMeetingNotes: meetingNotes 업데이트', () => {
    useTranscriptStore.getState().setMeetingNotes('# 회의 노트')
    expect(useTranscriptStore.getState().meetingNotes).toBe('# 회의 노트')
  })

  it('reset: 전체 상태 초기화', () => {
    useTranscriptStore.getState().setPartial({
      content: '테스트',
      speaker_label: 'SPEAKER_00',
      started_at_ms: 0,
    })
    useTranscriptStore.getState().setMeetingNotes('# 노트')
    useTranscriptStore.getState().reset()
    const state = useTranscriptStore.getState()
    expect(state.partial).toBeNull()
    expect(state.finals).toEqual([])
    expect(state.meetingNotes).toBeNull()
    expect(state.currentSpeaker).toBeNull()
  })

  it('여러 final 발화 순서 유지', () => {
    for (let i = 1; i <= 3; i++) {
      useTranscriptStore.getState().addFinal({
        id: i,
        content: `발화 ${i}`,
        speaker_label: 'SPEAKER_00',
        started_at_ms: i * 1000,
        ended_at_ms: i * 1000 + 3000,
        sequence_number: i,
        applied: false,
      })
    }
    const finals = useTranscriptStore.getState().finals
    expect(finals).toHaveLength(3)
    expect(finals[0].content).toBe('발화 1')
    expect(finals[2].content).toBe('발화 3')
  })
})
