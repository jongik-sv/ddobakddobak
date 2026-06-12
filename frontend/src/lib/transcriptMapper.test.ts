import { describe, it, expect } from 'vitest'
import { mapTranscriptsToFinals } from './transcriptMapper'

describe('mapTranscriptsToFinals', () => {
  it('speaker_name을 보존한다 (없으면 null)', () => {
    const finals = mapTranscriptsToFinals([
      {
        id: 1,
        speaker_label: '화자 1',
        speaker_name: '앨리스',
        content: '안녕하세요',
        started_at_ms: 0,
        ended_at_ms: 1000,
        sequence_number: 1,
      },
      {
        id: 2,
        speaker_label: '화자 2',
        content: '반갑습니다',
        started_at_ms: 1000,
        ended_at_ms: 2000,
        sequence_number: 2,
      },
    ])

    expect(finals[0].speaker_name).toBe('앨리스')
    expect(finals[1].speaker_name).toBeNull()
  })
})
