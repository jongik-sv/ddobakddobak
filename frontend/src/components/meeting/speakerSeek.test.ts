import { describe, it, expect } from 'vitest'
import { pickSpeakerTarget } from './speakerSeek'
import type { TranscriptFinalData } from '../../channels/transcription'

// 화자 발화 헬퍼 (started_at_ms asc 가정)
function utt(id: number, startedAtMs: number): TranscriptFinalData {
  return {
    id,
    content: `발화 ${id}`,
    speaker_label: '화자 1',
    started_at_ms: startedAtMs,
    ended_at_ms: startedAtMs + 1000,
    sequence_number: id,
    applied: false,
  }
}

describe('pickSpeakerTarget', () => {
  it('발화 0개면 null', () => {
    expect(
      pickSpeakerTarget([], { currentTimeMs: 0, isPlaying: false, lastJumpMs: -1 }),
    ).toBeNull()
  })

  it('콜드스타트(재생중 아님·커서 0·점프이력 없음) → 첫 발화 (started_at_ms===0 포함)', () => {
    const utts = [utt(1, 0), utt(2, 5000)]
    const target = pickSpeakerTarget(utts, {
      currentTimeMs: 0,
      isPlaying: false,
      lastJumpMs: -1,
    })
    // started_at_ms===0이라도 첫 발화로 가야 한다 (hasCursor가 막아야 함)
    expect(target).toBe(utts[0])
  })

  it('재생중·현재 위치가 발화1·발화2 사이 → 발화2', () => {
    const utts = [utt(1, 0), utt(2, 5000), utt(3, 10000)]
    const target = pickSpeakerTarget(utts, {
      currentTimeMs: 3000,
      isPlaying: true,
      lastJumpMs: -1,
    })
    expect(target).toBe(utts[1])
  })

  it('일시정지·커서 존재(currentTimeMs>0) → 첫 발화가 아니라 다음으로 진행 (의도적 deviation)', () => {
    const utts = [utt(1, 0), utt(2, 5000), utt(3, 10000)]
    const target = pickSpeakerTarget(utts, {
      currentTimeMs: 3000,
      isPlaying: false,
      lastJumpMs: -1,
    })
    // 커서가 있으므로 첫 발화(utts[0])로 튀지 않고 발화2로 진행
    expect(target).toBe(utts[1])
    expect(target).not.toBe(utts[0])
  })

  it('lastJumpMs가 currentTimeMs보다 앞 → max(cur,lastJump) 기준 다음 발화 (연타 가드)', () => {
    const utts = [utt(1, 0), utt(2, 5000), utt(3, 10000)]
    // timeupdate가 아직 안 와 currentTimeMs는 0이지만 직전 점프는 발화2(5000)
    const target = pickSpeakerTarget(utts, {
      currentTimeMs: 0,
      isPlaying: true,
      lastJumpMs: 5000,
    })
    // base=max(0,5000)=5000 → 5000 초과 첫 발화 = 발화3
    expect(target).toBe(utts[2])
  })

  it('현재 위치가 마지막 발화 이후 → 첫 발화로 wrap', () => {
    const utts = [utt(1, 0), utt(2, 5000), utt(3, 10000)]
    const target = pickSpeakerTarget(utts, {
      currentTimeMs: 99999,
      isPlaying: true,
      lastJumpMs: -1,
    })
    expect(target).toBe(utts[0])
  })
})
