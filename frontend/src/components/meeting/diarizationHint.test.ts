import { describe, it, expect } from 'vitest'
import { shouldShowDiarizationHint } from './diarizationHint'

const base = {
  diarizationEnabled: true,
  meetingNotes: '' as string | null,
  isSummarizing: false,
}

describe('shouldShowDiarizationHint', () => {
  it('회귀: finals가 전부 같은 화자라벨이면(실제 분리 안 됨) false', () => {
    // 버그 시나리오 — 전사가 모두 "화자 1"인데 안내문이 떴었다.
    const finals = [{ speaker_label: '화자 1' }, { speaker_label: '화자 1' }]
    expect(shouldShowDiarizationHint({ ...base, finals })).toBe(false)
  })

  it('distinct 화자라벨 2종 이상이면 true', () => {
    const finals = [{ speaker_label: '화자 1' }, { speaker_label: '화자 2' }]
    expect(shouldShowDiarizationHint({ ...base, finals })).toBe(true)
  })

  it('distinct>1이라도 meetingNotes가 이미 있으면 false', () => {
    const finals = [{ speaker_label: '화자 1' }, { speaker_label: '화자 2' }]
    expect(shouldShowDiarizationHint({ ...base, finals, meetingNotes: '기존 회의록' })).toBe(false)
  })

  it('distinct>1이라도 diarizationEnabled=false면 false', () => {
    const finals = [{ speaker_label: '화자 1' }, { speaker_label: '화자 2' }]
    expect(shouldShowDiarizationHint({ ...base, finals, diarizationEnabled: false })).toBe(false)
  })

  it('distinct>1이라도 isSummarizing 중이면 false', () => {
    const finals = [{ speaker_label: '화자 1' }, { speaker_label: '화자 2' }]
    expect(shouldShowDiarizationHint({ ...base, finals, isSummarizing: true })).toBe(false)
  })

  it('finals 빈 배열이면 false', () => {
    expect(shouldShowDiarizationHint({ ...base, finals: [] })).toBe(false)
  })

  it('meetingNotes가 null이어도(빈값 취급) distinct>1이면 true', () => {
    const finals = [{ speaker_label: '화자 1' }, { speaker_label: '화자 2' }]
    expect(shouldShowDiarizationHint({ ...base, finals, meetingNotes: null })).toBe(true)
  })
})
