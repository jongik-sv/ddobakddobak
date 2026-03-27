import { describe, it, expect } from 'vitest'
import { finalToBlock, transcriptsToBlocks } from './transcriptBlocks'
import type { TranscriptFinalData } from '../channels/transcription'

const makeFinal = (overrides: Partial<TranscriptFinalData> = {}): TranscriptFinalData => ({
  id: 1,
  content: '안녕하세요',
  speaker_label: 'SPEAKER_00',
  started_at_ms: 0,
  ended_at_ms: 1000,
  sequence_number: 1,
  applied: false,
  ...overrides,
})

describe('finalToBlock', () => {
  it('TranscriptFinalData를 transcript 타입 블록으로 변환한다', () => {
    const final = makeFinal()
    const block = finalToBlock(final)
    expect(block.type).toBe('transcript')
  })

  it('speaker_label이 speakerLabel prop에 올바르게 매핑된다', () => {
    const final = makeFinal({ speaker_label: 'SPEAKER_01' })
    const block = finalToBlock(final)
    expect(block.props.speakerLabel).toBe('SPEAKER_01')
  })

  it('content가 text prop에 올바르게 매핑된다', () => {
    const final = makeFinal({ content: '테스트 내용입니다' })
    const block = finalToBlock(final)
    expect(block.props.text).toBe('테스트 내용입니다')
  })

  it('다양한 speaker_label 값이 그대로 speakerLabel에 전달된다', () => {
    const final = makeFinal({ speaker_label: 'SPEAKER_99' })
    const block = finalToBlock(final)
    expect(block.props.speakerLabel).toBe('SPEAKER_99')
  })
})

describe('transcriptsToBlocks', () => {
  it('빈 배열 입력 시 빈 배열을 반환한다', () => {
    expect(transcriptsToBlocks([])).toEqual([])
  })

  it('단일 항목 배열을 단일 블록 배열로 변환한다', () => {
    const finals = [makeFinal()]
    const blocks = transcriptsToBlocks(finals)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('transcript')
  })

  it('복수 항목의 순서가 보존된다', () => {
    const finals = [
      makeFinal({ id: 1, content: '첫 번째', speaker_label: 'SPEAKER_00', sequence_number: 1 }),
      makeFinal({ id: 2, content: '두 번째', speaker_label: 'SPEAKER_01', sequence_number: 2 }),
      makeFinal({ id: 3, content: '세 번째', speaker_label: 'SPEAKER_00', sequence_number: 3 }),
    ]
    const blocks = transcriptsToBlocks(finals)
    expect(blocks).toHaveLength(3)
    expect(blocks[0].props.text).toBe('첫 번째')
    expect(blocks[0].props.speakerLabel).toBe('SPEAKER_00')
    expect(blocks[1].props.text).toBe('두 번째')
    expect(blocks[1].props.speakerLabel).toBe('SPEAKER_01')
    expect(blocks[2].props.text).toBe('세 번째')
    expect(blocks[2].props.speakerLabel).toBe('SPEAKER_00')
  })

  it('각 항목이 올바른 props를 갖는 transcript 블록으로 변환된다', () => {
    const finals = [
      makeFinal({ content: '내용A', speaker_label: 'SPEAKER_A' }),
      makeFinal({ content: '내용B', speaker_label: 'SPEAKER_B' }),
    ]
    const blocks = transcriptsToBlocks(finals)
    expect(blocks[0]).toEqual({ type: 'transcript', props: { speakerLabel: 'SPEAKER_A', text: '내용A' } })
    expect(blocks[1]).toEqual({ type: 'transcript', props: { speakerLabel: 'SPEAKER_B', text: '내용B' } })
  })
})
