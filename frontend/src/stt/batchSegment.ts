// 배치(녹음-후) 재전사용 세그먼테이션. 연속 녹음 PCM 전체를 받아 발화 구간
// [startSample, endSample]로 잘라낸다. **명시적 샘플 오프셋**을 돌려주므로 재전사된
// 세그먼트의 started_at_ms가 연속 녹음 타임라인과 정확히 정렬된다(seek 정합).
//
// 실시간 SegmentAccumulator(채워넣기식 VAD)는 오프셋을 노출하지 않아 batch엔 부적합.
// 여기선 전체 신호를 가지므로 단순 3-pass로 처리한다:
//   1) 프레임별 speech 여부(RMS > speech_threshold),
//   2) 인접 speech를 region으로 합치되 minSilence 미만 갭은 한 발화로 병합,
//   3) preroll/tail 패딩 + maxSeg(Cohere 8s) 초과 region은 overlap 두고 분할, 초단편 제거.

export interface BatchSegmentOpts {
  sampleRate: number
  /** 이 RMS 초과 프레임을 speech로 본다(config speech_threshold). */
  speechThreshold: number
  /** 이 길이 미만 무음 갭은 같은 발화로 병합(config silence_duration_ms). */
  minSilenceMs: number
  /** 세그먼트 최대 길이(s). Cohere 8s로 하드클램프. */
  maxSegmentS: number
  /** 발화 앞 패딩(첫 음절 보존). */
  prerollMs: number
}

export interface BatchSeg {
  /** 시작 샘플(포함). */
  start: number
  /** 끝 샘플(미포함). */
  end: number
}

const FRAME = 512

/** 연속 PCM(Float32 16k mono) → 발화 세그먼트 [start,end] 목록(샘플 인덱스). */
export function segmentPcm(pcm: Float32Array, opts: BatchSegmentOpts): BatchSeg[] {
  const sr = opts.sampleRate
  const maxSeg = Math.min(opts.maxSegmentS, 8) * sr
  const preroll = Math.floor((opts.prerollMs / 1000) * sr)
  const tail = Math.floor(0.2 * sr)
  const overlap = Math.floor(0.4 * sr)
  const minRegion = Math.floor(0.3 * sr) // 이보다 짧은 발화/잡음 블립은 버린다.
  const gapFrames = Math.ceil((opts.minSilenceMs / 1000) * sr / FRAME)

  if (pcm.length === 0) return []

  // 1) 프레임별 speech 플래그.
  const nFrames = Math.ceil(pcm.length / FRAME)
  const speech = new Array<boolean>(nFrames)
  for (let f = 0; f < nFrames; f++) {
    const i = f * FRAME
    const end = Math.min(i + FRAME, pcm.length)
    let sumSq = 0
    for (let j = i; j < end; j++) sumSq += pcm[j] * pcm[j]
    speech[f] = Math.sqrt(sumSq / (end - i)) > opts.speechThreshold
  }

  // 2) speech region 병합(minSilence 미만 갭은 한 발화로).
  const regions: BatchSeg[] = []
  let f = 0
  while (f < nFrames) {
    if (!speech[f]) {
      f++
      continue
    }
    let last = f
    let gap = 0
    let j = f + 1
    for (; j < nFrames; j++) {
      if (speech[j]) {
        last = j
        gap = 0
      } else {
        gap++
        if (gap > gapFrames) break
      }
    }
    regions.push({ start: f * FRAME, end: Math.min(pcm.length, (last + 1) * FRAME) })
    f = j
  }

  // 3) 초단편 제거(패딩 전 실제 발화 길이 기준) → preroll/tail 패딩 → maxSeg 초과 분할.
  const segs: BatchSeg[] = []
  for (const r of regions) {
    if (r.end - r.start < minRegion) continue // 초단편 잡음 블립 제거.
    const rs = Math.max(0, r.start - preroll)
    const re = Math.min(pcm.length, r.end + tail)
    if (re - rs <= maxSeg) {
      segs.push({ start: rs, end: re })
    } else {
      let s = rs
      while (s < re) {
        const e = Math.min(re, s + maxSeg)
        segs.push({ start: s, end: e })
        if (e >= re) break
        s = e - overlap // 경계 음절 보존용 오버랩.
      }
    }
  }
  return segs
}
