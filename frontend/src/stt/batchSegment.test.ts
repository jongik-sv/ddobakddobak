import { describe, it, expect } from 'vitest'
import { segmentPcm, type BatchSegmentOpts } from './batchSegment'

const SR = 16000
const OPTS: BatchSegmentOpts = {
  sampleRate: SR,
  speechThreshold: 0.06,
  minSilenceMs: 500,
  maxSegmentS: 8,
  prerollMs: 500,
}

/** [{speech:boolean, sec:number}] 구간을 이어붙여 PCM Float32 생성. speech=진폭 0.2, 무음=0. */
function buildPcm(parts: { speech: boolean; sec: number }[]): Float32Array {
  const total = parts.reduce((n, p) => n + Math.round(p.sec * SR), 0)
  const pcm = new Float32Array(total)
  let off = 0
  for (const p of parts) {
    const len = Math.round(p.sec * SR)
    if (p.speech) for (let i = 0; i < len; i++) pcm[off + i] = i % 2 === 0 ? 0.2 : -0.2
    off += len
  }
  return pcm
}

describe('segmentPcm', () => {
  it('빈 입력 → 빈 배열', () => {
    expect(segmentPcm(new Float32Array(0), OPTS)).toEqual([])
  })

  it('단일 발화 → 1세그먼트(앞 preroll 패딩 포함)', () => {
    // 1s 무음 + 3s 발화 + 1s 무음
    const pcm = buildPcm([
      { speech: false, sec: 1 },
      { speech: true, sec: 3 },
      { speech: false, sec: 1 },
    ])
    const segs = segmentPcm(pcm, OPTS)
    expect(segs.length).toBe(1)
    // 발화 시작 1.0s 지점 - preroll 0.5s = ~0.5s 부근에서 시작.
    expect(segs[0].start).toBeLessThan(1 * SR)
    expect(segs[0].start).toBeGreaterThanOrEqual(0.5 * SR - FRAME_SLOP)
    // 발화 끝 4.0s + tail ~0.2s 부근.
    expect(segs[0].end).toBeGreaterThan(3.5 * SR)
  })

  it('긴 무음으로 분리된 두 발화 → 2세그먼트', () => {
    const pcm = buildPcm([
      { speech: true, sec: 2 },
      { speech: false, sec: 1.5 }, // > minSilence(0.5s) → 분리
      { speech: true, sec: 2 },
    ])
    const segs = segmentPcm(pcm, OPTS)
    expect(segs.length).toBe(2)
  })

  it('짧은 갭(<minSilence)은 한 발화로 병합', () => {
    const pcm = buildPcm([
      { speech: true, sec: 2 },
      { speech: false, sec: 0.2 }, // < 0.5s → 병합
      { speech: true, sec: 2 },
    ])
    const segs = segmentPcm(pcm, OPTS)
    expect(segs.length).toBe(1)
  })

  it('8s 초과 연속 발화 → 분할, 각 ≤8s, 오버랩 존재', () => {
    const pcm = buildPcm([{ speech: true, sec: 20 }])
    const segs = segmentPcm(pcm, OPTS)
    expect(segs.length).toBeGreaterThan(1)
    for (const s of segs) {
      expect(s.end - s.start).toBeLessThanOrEqual(8 * SR + 1)
    }
    // 인접 세그먼트 오버랩(다음 시작 < 이전 끝).
    expect(segs[1].start).toBeLessThan(segs[0].end)
  })

  it('초단편(<0.3s) 잡음 블립은 버린다', () => {
    const pcm = buildPcm([
      { speech: false, sec: 1 },
      { speech: true, sec: 0.1 },
      { speech: false, sec: 1 },
    ])
    expect(segmentPcm(pcm, OPTS).length).toBe(0)
  })
})

// 프레임(512) 경계 슬롭 허용치.
const FRAME_SLOP = 512
