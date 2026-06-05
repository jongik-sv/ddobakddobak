// mic 경로와 fixture 경로가 공유하는 후처리 헬퍼. SQLite에 저장/내보내기 전에
// 텍스트는 항상 정리되어야 한다.

/**
 * EOS leak 가드: Cohere Transcribe가 결과 끝에 `<|endoftext|>` 류 특수토큰을
 * 흘리는 경우가 있어 첫 `"<|"`에서 잘라낸다. Rust 측 컷과 멱등(idempotent)이며,
 * Android FFI 경로도 동일하게 방어한다.
 */
export function cutEosLeak(text: string): string {
  const i = text.indexOf("<|");
  return (i >= 0 ? text.slice(0, i) : text).trim();
}

/** PCM RMS(에너지). 무음/잡음 세그먼트 게이팅에 사용. */
export function rms(pcm: Float32Array): number {
  let s = 0;
  for (let i = 0; i < pcm.length; i++) s += pcm[i] * pcm[i];
  return Math.sqrt(s / pcm.length);
}

// 이 값 미만의 RMS는 무음/잡음으로 보고 게이트한다. silero VAD가 near-silence
// (rms~0.002)를 발화로 흘리면 ASR이 외국어(중국어 등)를 환각하므로 차단한다.
export const RMS_GATE = 0.015;

/**
 * STT 입력 전용 레벨 정규화. 원거리/작은 목소리를 목표 RMS로 끌어올려 모델 환각을 줄인다.
 * **저장/재생 오디오엔 적용하지 않는다**(재생본은 연속 raw 녹음). 부스트 전용(이미 큰 발화
 * 무보정) + 피크 상한(신규 클리핑 방지). 라이브(useLocalStt)·배치(retranscribe) 공용.
 */
export function normalizeForStt(seg: Float32Array): Float32Array {
  if (seg.length === 0) return seg;
  const TARGET_RMS = 0.12;
  const MAX_NORM = 8;
  let sumSq = 0;
  let peak = 0;
  for (let i = 0; i < seg.length; i++) {
    const v = seg[i];
    sumSq += v * v;
    const a = v < 0 ? -v : v;
    if (a > peak) peak = a;
  }
  const rmsVal = Math.sqrt(sumSq / seg.length);
  let norm = rmsVal > 0 ? TARGET_RMS / rmsVal : 1;
  if (norm > MAX_NORM) norm = MAX_NORM;
  if (peak > 0 && norm > 0.99 / peak) norm = 0.99 / peak; // 신규 클리핑 방지
  if (norm <= 1) return seg;
  const out = new Float32Array(seg.length);
  for (let i = 0; i < seg.length; i++) out[i] = seg[i] * norm;
  return out;
}
