import { describe, it, expect } from 'vitest'
import { planLiveBaselineLoad } from './meetingLiveBaseline'

describe('planLiveBaselineLoad', () => {
  it('idle(녹음 비활성)이면 reset 후 전사+요약 로드 — notes 상태 무관', () => {
    expect(planLiveBaselineLoad({ activeMeetingId: null, meetingId: 5, notesEmpty: false }))
      .toEqual({ loadFinals: true, loadSummary: true, reset: true })
    expect(planLiveBaselineLoad({ activeMeetingId: null, meetingId: 5, notesEmpty: true }))
      .toEqual({ loadFinals: true, loadSummary: true, reset: true })
  })

  it('이 회의 녹음 중 + 회의록 비었음 → finals union + 요약 로드, reset 없음', () => {
    expect(planLiveBaselineLoad({ activeMeetingId: 5, meetingId: 5, notesEmpty: true }))
      .toEqual({ loadFinals: true, loadSummary: true, reset: false })
  })

  it('이 회의 녹음 중 + 회의록 이미 있음(라이브 요약) → finals만 복원, 요약은 덮지 않음', () => {
    expect(planLiveBaselineLoad({ activeMeetingId: 5, meetingId: 5, notesEmpty: false }))
      .toEqual({ loadFinals: true, loadSummary: false, reset: false })
  })

  it('회귀: finals가 신규 발화로 다시 차도(notesEmpty 무관) 이 회의면 finals 복원은 항상', () => {
    // emptiness 게이트가 아니라 "이 회의 녹음 중"이면 무조건 union → 히스토리 복원 보장
    expect(planLiveBaselineLoad({ activeMeetingId: 5, meetingId: 5, notesEmpty: false }).loadFinals)
      .toBe(true)
  })

  it('다른 회의 녹음 중 → 아무것도 안 함(타 세션 소유 store 보호)', () => {
    expect(planLiveBaselineLoad({ activeMeetingId: 9, meetingId: 5, notesEmpty: true }))
      .toEqual({ loadFinals: false, loadSummary: false, reset: false })
    expect(planLiveBaselineLoad({ activeMeetingId: 9, meetingId: 5, notesEmpty: false }))
      .toEqual({ loadFinals: false, loadSummary: false, reset: false })
  })
})
