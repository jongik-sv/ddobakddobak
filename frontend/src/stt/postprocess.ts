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
