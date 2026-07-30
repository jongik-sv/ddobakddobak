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

describe('summaryError 상태', () => {
  beforeEach(() => {
    useTranscriptStore.getState().reset()
  })

  it('초기값은 null', () => {
    expect(useTranscriptStore.getState().summaryError).toBeNull()
  })

  it('setSummaryError: 실패 상태 세팅과 해제', () => {
    useTranscriptStore.getState().setSummaryError({ kind: 'realtime', message: 'LLM 오류' })
    expect(useTranscriptStore.getState().summaryError).toEqual({ kind: 'realtime', message: 'LLM 오류' })

    useTranscriptStore.getState().setSummaryError(null)
    expect(useTranscriptStore.getState().summaryError).toBeNull()
  })

  it('reset: summaryError 클리어', () => {
    useTranscriptStore.getState().setSummaryError({ kind: 'final', message: '실패' })
    useTranscriptStore.getState().reset()
    expect(useTranscriptStore.getState().summaryError).toBeNull()
  })
})

describe('updateFinal', () => {
  beforeEach(() => {
    useTranscriptStore.setState({
      partial: null,
      finals: [],
      appliedIds: new Set<number>(),
      meetingNotes: null,
      currentSpeaker: null,
      isSummarizing: false,
      summarizationKind: null,
      lastUserEditAt: 0,
      lastResetAt: 0,
    })
  })

  it('일치하는 final의 content만 교체한다', () => {
    useTranscriptStore.getState().loadFinals([
      { id: 1, content: '원본 1', speaker_label: 'A', started_at_ms: 0, ended_at_ms: 1000, sequence_number: 1, applied: false },
      { id: 2, content: '원본 2', speaker_label: 'B', started_at_ms: 1000, ended_at_ms: 2000, sequence_number: 2, applied: true },
    ])

    useTranscriptStore.getState().updateFinal(1, '수정됨')

    const finals = useTranscriptStore.getState().finals
    expect(finals.find((f) => f.id === 1)?.content).toBe('수정됨')
    expect(finals.find((f) => f.id === 2)?.content).toBe('원본 2')
  })

  it('applied 플래그를 보존한다', () => {
    useTranscriptStore.getState().loadFinals([
      { id: 5, content: 'x', speaker_label: 'A', started_at_ms: 0, ended_at_ms: 1000, sequence_number: 1, applied: true },
    ])
    useTranscriptStore.getState().updateFinal(5, 'y')
    expect(useTranscriptStore.getState().finals[0].applied).toBe(true)
  })

  it('일치하는 id가 없으면 no-op', () => {
    useTranscriptStore.getState().loadFinals([
      { id: 1, content: 'a', speaker_label: 'A', started_at_ms: 0, ended_at_ms: 1000, sequence_number: 1, applied: false },
    ])
    const before = useTranscriptStore.getState().finals
    useTranscriptStore.getState().updateFinal(999, 'z')
    expect(useTranscriptStore.getState().finals).toBe(before)
  })
})

describe('applySplit', () => {
  beforeEach(() => {
    useTranscriptStore.getState().reset()
    useTranscriptStore.getState().loadFinals([
      { id: 1, content: '첫 발화', speaker_label: 'A', speaker_name: null, started_at_ms: 0, ended_at_ms: 1000, sequence_number: 1, applied: false },
      { id: 2, content: '둘째발화 서로다른화자섞임', speaker_label: 'B', speaker_name: null, started_at_ms: 1000, ended_at_ms: 4000, sequence_number: 2, applied: false },
      { id: 3, content: '셋째 발화', speaker_label: 'A', speaker_name: null, started_at_ms: 4000, ended_at_ms: 5000, sequence_number: 3, applied: false },
    ])
  })

  it('기존 항목을 updated로 갱신하고 바로 뒤에 inserted를 끼운다', () => {
    useTranscriptStore.getState().applySplit(
      {
        id: 2,
        content: '둘째발화',
        speaker_label: 'B',
        speaker_name: null,
        started_at_ms: 1000,
        ended_at_ms: 2500,
        sequence_number: 2,
        applied_to_minutes: false,
      },
      {
        id: 10,
        content: '서로다른화자섞임',
        speaker_label: 'C',
        speaker_name: '김철수',
        started_at_ms: 2500,
        ended_at_ms: 4000,
        sequence_number: 3,
        applied_to_minutes: false,
      },
    )

    const finals = useTranscriptStore.getState().finals
    expect(finals.map((f) => f.id)).toEqual([1, 2, 10, 3])
    expect(finals[1].content).toBe('둘째발화')
    expect(finals[1].ended_at_ms).toBe(2500)
    expect(finals[2].content).toBe('서로다른화자섞임')
    expect(finals[2].speaker_label).toBe('C')
    expect(finals[2].speaker_name).toBe('김철수')
    expect(finals[2].started_at_ms).toBe(2500)
  })

  it('applied_to_minutes: true 승계 → 양쪽 다 applied true, appliedIds에도 반영', () => {
    useTranscriptStore.getState().applySplit(
      { id: 1, content: 'a', speaker_label: 'A', started_at_ms: 0, ended_at_ms: 500, sequence_number: 1, applied_to_minutes: true },
      { id: 20, content: 'b', speaker_label: 'A', started_at_ms: 500, ended_at_ms: 1000, sequence_number: 2, applied_to_minutes: true },
    )
    const state = useTranscriptStore.getState()
    expect(state.finals.find((f) => f.id === 1)?.applied).toBe(true)
    expect(state.finals.find((f) => f.id === 20)?.applied).toBe(true)
    expect(state.appliedIds.has(1)).toBe(true)
    expect(state.appliedIds.has(20)).toBe(true)
  })

  it('updated.id를 못 찾으면 no-op', () => {
    const before = useTranscriptStore.getState().finals
    useTranscriptStore.getState().applySplit(
      { id: 999, content: 'x', speaker_label: 'A', started_at_ms: 0, ended_at_ms: 500, sequence_number: 1 },
      { id: 1000, content: 'y', speaker_label: 'A', started_at_ms: 500, ended_at_ms: 1000, sequence_number: 2 },
    )
    expect(useTranscriptStore.getState().finals).toBe(before)
  })

  it('트레일링 행의 sequence_number가 서버 재번호 규칙대로 +1 된다', () => {
    // beforeEach 기준: id1(seq1), id2(seq2), id3(seq3). id2를 분할하면 백엔드는 id2 뒤(seq>2)인
    // id3을 seq+1(=4)로 재번호하고, 삽입 행은 orig_sequence+1(=3)을 받는다. 응답 {updated, inserted}엔
    // 이 재번호 정보가 없으므로 applySplit이 직접 미러링해야 한다.
    useTranscriptStore.getState().applySplit(
      { id: 2, content: '둘째발화', speaker_label: 'B', started_at_ms: 1000, ended_at_ms: 2500, sequence_number: 2 },
      { id: 10, content: '서로다른화자섞임', speaker_label: 'C', started_at_ms: 2500, ended_at_ms: 4000, sequence_number: 3 },
    )
    const finals = useTranscriptStore.getState().finals
    expect(finals.find((f) => f.id === 1)?.sequence_number).toBe(1) // 분할 대상 앞 — 불변
    expect(finals.find((f) => f.id === 2)?.sequence_number).toBe(2) // 원행(조각1) — 불변
    expect(finals.find((f) => f.id === 10)?.sequence_number).toBe(3) // 삽입(조각2) — orig+1
    expect(finals.find((f) => f.id === 3)?.sequence_number).toBe(4) // 트레일링 — 서버가 +1 재번호한 것과 동일해야 함
  })

  it('audio_source는 transcript_json에 없으므로 기존 항목 값을 승계한다', () => {
    useTranscriptStore.setState((state) => ({
      finals: state.finals.map((f) => (f.id === 2 ? { ...f, audio_source: 'system' as const } : f)),
    }))
    useTranscriptStore.getState().applySplit(
      { id: 2, content: 'a', speaker_label: 'B', started_at_ms: 1000, ended_at_ms: 2500, sequence_number: 2 },
      { id: 30, content: 'b', speaker_label: 'B', started_at_ms: 2500, ended_at_ms: 4000, sequence_number: 3 },
    )
    const finals = useTranscriptStore.getState().finals
    expect(finals.find((f) => f.id === 2)?.audio_source).toBe('system')
    expect(finals.find((f) => f.id === 30)?.audio_source).toBe('system')
  })
})

describe('markRemoteSplit', () => {
  beforeEach(() => {
    useTranscriptStore.getState().reset()
  })

  it('호출할 때마다 remoteSplitRevision을 증가시킨다', () => {
    expect(useTranscriptStore.getState().remoteSplitRevision).toBe(0)
    useTranscriptStore.getState().markRemoteSplit()
    expect(useTranscriptStore.getState().remoteSplitRevision).toBe(1)
    useTranscriptStore.getState().markRemoteSplit()
    expect(useTranscriptStore.getState().remoteSplitRevision).toBe(2)
  })

  it('applySplit 자체는 remoteSplitRevision을 건드리지 않는다 (로컬 경로에서 이중 재조회 방지)', () => {
    useTranscriptStore.getState().loadFinals([
      { id: 1, content: 'a', speaker_label: 'A', started_at_ms: 0, ended_at_ms: 1000, sequence_number: 1, applied: false },
    ])
    useTranscriptStore.getState().applySplit(
      { id: 1, content: 'x', speaker_label: 'A', started_at_ms: 0, ended_at_ms: 500, sequence_number: 1 },
      { id: 2, content: 'y', speaker_label: 'A', started_at_ms: 500, ended_at_ms: 1000, sequence_number: 2 },
    )
    expect(useTranscriptStore.getState().remoteSplitRevision).toBe(0)
  })
})

describe('speaker_name 갱신', () => {
  const base = {
    content: '발화',
    started_at_ms: 0,
    ended_at_ms: 1000,
    sequence_number: 1,
    applied: false,
  }

  beforeEach(() => {
    useTranscriptStore.getState().reset()
    useTranscriptStore.getState().loadFinals([
      { ...base, id: 1, speaker_label: '화자 1' },
      { ...base, id: 2, speaker_label: '화자 2', started_at_ms: 1000, sequence_number: 2 },
    ])
  })

  it('setSpeakerName: 해당 라벨 finals만 speaker_name 갱신', () => {
    useTranscriptStore.getState().setSpeakerName('화자 1', '앨리스')

    const finals = useTranscriptStore.getState().finals
    expect(finals.find((f) => f.id === 1)?.speaker_name).toBe('앨리스')
    expect(finals.find((f) => f.id === 2)?.speaker_name).toBeUndefined()
  })

  it('setSpeakerName(label, null): 이름 해제', () => {
    useTranscriptStore.getState().setSpeakerName('화자 1', '앨리스')
    useTranscriptStore.getState().setSpeakerName('화자 1', null)

    expect(useTranscriptStore.getState().finals.find((f) => f.id === 1)?.speaker_name).toBeNull()
  })

  it('clearSpeakerNames: 모든 finals의 speaker_name 제거', () => {
    useTranscriptStore.getState().setSpeakerName('화자 1', '앨리스')
    useTranscriptStore.getState().setSpeakerName('화자 2', '밥')
    useTranscriptStore.getState().clearSpeakerNames()

    for (const f of useTranscriptStore.getState().finals) {
      expect(f.speaker_name ?? null).toBeNull()
    }
  })
})
