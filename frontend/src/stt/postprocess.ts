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

// hasSpeech 프레임 파라미터.
// - 연속 3프레임(300ms) ≥ RMS_GATE → 발화: 산발적 클릭/숨소리(비연속)는 차단.
// - 단일 프레임 ≥ FRAME_HIGH_GATE(워클릿 VAD 진입 레벨) → 발화: 짧은 단음절
//   ('네','응' ~200ms)을 살린다. 저레벨 클릭/팝(< 0.05)은 단발로는 통과 못 한다.
//   (큰 클릭은 과거 통짜 게이트도 통과시켰다 — 여기서 더 나빠지지 않음.)
const SPEECH_FRAME_MS = 100;
const MIN_CONSECUTIVE_SPEECH_FRAMES = 3;
const FRAME_HIGH_GATE = 0.05;

/**
 * 프레임(100ms) 단위 발화 존재 판정. 통짜 rms() 게이트는 "짧은 발화 + 긴 무음 패딩"
 * 청크에서 RMS가 희석돼 정상 발화를 통째로 드랍한다 — 여기선
 * (a) RMS_GATE를 넘는 프레임이 연속 300ms 이상이거나
 * (b) 고에너지 프레임(FRAME_HIGH_GATE)이 하나라도 있으면 발화로 본다.
 */
export function hasSpeech(pcm: Float32Array, sampleRate = 16000): boolean {
  if (pcm.length === 0) return false;
  const frame = Math.max(1, Math.round((sampleRate * SPEECH_FRAME_MS) / 1000));
  let consecutive = 0;
  for (let off = 0; off < pcm.length; off += frame) {
    const end = Math.min(off + frame, pcm.length);
    let s = 0;
    for (let i = off; i < end; i++) s += pcm[i] * pcm[i];
    const r = Math.sqrt(s / (end - off));
    if (r >= FRAME_HIGH_GATE) return true;
    if (r >= RMS_GATE) {
      consecutive++;
      if (consecutive >= MIN_CONSECUTIVE_SPEECH_FRAMES) return true;
    } else {
      consecutive = 0;
    }
  }
  return false;
}

/**
 * RMS_GATE를 넘는 프레임이 하나라도 있는가 — 8s 분할 조각의 무음 패딩 판별용.
 * 청크 전체는 이미 hasSpeech를 통과했으므로 조각 게이트는 느슨해야 한다
 * (엄격하면 발화가 조각 경계에 걸칠 때 양쪽 조각이 모두 탈락해 통째 드랍).
 */
export function hasSpeechFrame(pcm: Float32Array, sampleRate = 16000): boolean {
  if (pcm.length === 0) return false;
  const frame = Math.max(1, Math.round((sampleRate * SPEECH_FRAME_MS) / 1000));
  for (let off = 0; off < pcm.length; off += frame) {
    const end = Math.min(off + frame, pcm.length);
    let s = 0;
    for (let i = off; i < end; i++) s += pcm[i] * pcm[i];
    if (Math.sqrt(s / (end - off)) >= RMS_GATE) return true;
  }
  return false;
}

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
