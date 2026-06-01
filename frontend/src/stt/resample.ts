// 방어적 리샘플 폴백. 1차 경로는 getUserMedia + AudioContext를 16k로 강제하므로
// Chromium WebView에서는 보통 동작하지 않는다(zero-overhead). ctx.sampleRate가
// 16000이 아닐 때만 VAD/chunker 앞단에서 선형 보간으로 16k로 맞춘다.

const TARGET_RATE = 16000;

/** 입력 레이트가 16k가 아니면 리샘플이 필요하다. */
export function shouldResample(rate: number): boolean {
  return rate !== TARGET_RATE;
}

/**
 * 선형 보간으로 16kHz로 리샘플한다.
 * @param frame 원본 PCM (mono, [-1,1])
 * @param srcRate 원본 샘플레이트
 * @returns 16k PCM. srcRate가 이미 16k면 입력을 그대로 반환.
 */
export function resampleTo16k(frame: Float32Array, srcRate: number): Float32Array {
  if (srcRate === TARGET_RATE || frame.length === 0) return frame;

  const ratio = TARGET_RATE / srcRate;
  const outLen = Math.round(frame.length * ratio);
  const out = new Float32Array(outLen);
  if (outLen === 0) return out;

  // 입력 인덱스 위치 = i / ratio. 인접 두 샘플을 선형 보간.
  const step = srcRate / TARGET_RATE;
  for (let i = 0; i < outLen; i++) {
    const pos = i * step;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, frame.length - 1);
    const t = pos - i0;
    out[i] = frame[i0] * (1 - t) + frame[i1] * t;
  }
  return out;
}
