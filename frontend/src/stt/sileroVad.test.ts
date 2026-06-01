import { describe, it, expect } from "vitest";
import {
  SileroVad,
  SPEECH_THRESHOLD,
  EXIT_THRESHOLD,
  FRAME_SIZE,
  type VadTensor,
  type TensorCtor,
  type VadSession,
} from "./sileroVad";
import {
  chunkerOptsFromAudioConfig,
  DEFAULT_AUDIO_CONFIG,
  MAX_SILENCE_MS,
  type AudioConfig,
} from "./vadConfig";

// ── 테스트용 fake Tensor (ONNX 런타임 없이 구조만 흉내) ──────────────
class FakeTensor implements VadTensor {
  type: "float32";
  data: Float32Array;
  dims: number[];
  constructor(type: "float32", data: Float32Array, dims: number[]) {
    this.type = type;
    this.data = data;
    this.dims = dims;
  }
}
const FakeTensorCtor = FakeTensor as unknown as TensorCtor;

/**
 * prob 시퀀스를 순서대로 돌려주는 fake 세션. 또한 매 호출마다 h/c를
 * (이전 상태에서 +1 한) 새 텐서로 갱신해, 클래스가 상태를 순환 스레딩하는지
 * 검증할 수 있게 한다(call N의 입력 h가 call N-1의 출력 new_h여야 한다).
 */
function makeFakeSession(probs: number[]): {
  session: VadSession;
  calls: { x: VadTensor; h: VadTensor; c: VadTensor }[];
} {
  const calls: { x: VadTensor; h: VadTensor; c: VadTensor }[] = [];
  let i = 0;
  const session: VadSession = async (inputs) => {
    calls.push(inputs);
    const p = probs[Math.min(i, probs.length - 1)];
    i++;
    const bumped = (t: VadTensor): VadTensor => {
      const next = new Float32Array(t.data.length);
      for (let k = 0; k < next.length; k++) next[k] = t.data[k] + 1;
      return new FakeTensor("float32", next, [2, 1, 64]);
    };
    return {
      prob: new FakeTensor("float32", new Float32Array([p]), [1, 1]),
      new_h: bumped(inputs.h),
      new_c: bumped(inputs.c),
    };
  };
  return { session, calls };
}

const frame = () => new Float32Array(FRAME_SIZE);

describe("SileroVad", () => {
  it("initializes h/c to zeros [2,1,64] and feeds x as [1,frameLen]", async () => {
    const { session, calls } = makeFakeSession([0.9]);
    const vad = new SileroVad(session, FakeTensorCtor);
    await vad.process(frame());
    expect(calls.length).toBe(1);
    // 첫 호출의 h/c는 영벡터(2*1*64=128).
    expect(calls[0].h.data.length).toBe(128);
    expect(Array.from(calls[0].h.data).every((v) => v === 0)).toBe(true);
    expect(Array.from(calls[0].c.data).every((v) => v === 0)).toBe(true);
    // x dims는 [1, FRAME_SIZE].
    expect((calls[0].x as unknown as { dims: number[] }).dims).toEqual([1, FRAME_SIZE]);
  });

  it("threads h/c state forward across frames (output of N → input of N+1)", async () => {
    // fake가 매번 +1 하므로 두 번째 호출 입력 h는 전부 1, 세 번째는 전부 2여야 한다.
    const { session, calls } = makeFakeSession([0.9, 0.9, 0.9]);
    const vad = new SileroVad(session, FakeTensorCtor);
    await vad.process(frame());
    await vad.process(frame());
    await vad.process(frame());
    expect(Array.from(calls[1].h.data).every((v) => v === 1)).toBe(true);
    expect(Array.from(calls[1].c.data).every((v) => v === 1)).toBe(true);
    expect(Array.from(calls[2].h.data).every((v) => v === 2)).toBe(true);
  });

  it("returns true when prob > SPEECH_THRESHOLD", async () => {
    const { session } = makeFakeSession([SPEECH_THRESHOLD + 0.01]);
    const vad = new SileroVad(session, FakeTensorCtor);
    expect(await vad.process(frame())).toBe(true);
  });

  it("returns false when idle and prob < SPEECH_THRESHOLD", async () => {
    const { session } = makeFakeSession([SPEECH_THRESHOLD - 0.01]);
    const vad = new SileroVad(session, FakeTensorCtor);
    expect(await vad.process(frame())).toBe(false);
  });

  it("hysteresis: stays recording while EXIT <= prob <= SPEECH, exits below EXIT", async () => {
    // 0.9(시작) → 0.2(EXIT 이상, SPEECH 미만이지만 녹음 유지) → 0.05(EXIT 미만, 종료)
    const mid = (SPEECH_THRESHOLD + EXIT_THRESHOLD) / 2; // 0.2
    const below = EXIT_THRESHOLD - 0.05; // 0.05
    const { session } = makeFakeSession([0.9, mid, below]);
    const vad = new SileroVad(session, FakeTensorCtor);
    expect(await vad.process(frame())).toBe(true); // 시작
    expect(await vad.process(frame())).toBe(true); // 히스테리시스 유지
    expect(await vad.process(frame())).toBe(false); // EXIT 미만 → 종료
  });

  it("does NOT start on a mid-range prob when idle (no false onset)", async () => {
    // 녹음 아닌 상태에서 0.2(EXIT≤p<SPEECH)는 발화로 보지 않는다.
    const mid = (SPEECH_THRESHOLD + EXIT_THRESHOLD) / 2;
    const { session } = makeFakeSession([mid]);
    const vad = new SileroVad(session, FakeTensorCtor);
    expect(await vad.process(frame())).toBe(false);
  });

  it("re-onsets after exit (recording latch cleared)", async () => {
    const { session } = makeFakeSession([0.9, EXIT_THRESHOLD - 0.05, 0.9]);
    const vad = new SileroVad(session, FakeTensorCtor);
    await vad.process(frame()); // start
    await vad.process(frame()); // exit (latch off)
    expect(await vad.process(frame())).toBe(true); // 다시 발화 시작
  });

  it("reset() zeros state and clears recording latch", async () => {
    const { session, calls } = makeFakeSession([0.9, 0.9]);
    const vad = new SileroVad(session, FakeTensorCtor);
    await vad.process(frame()); // h/c now bumped to 1
    vad.reset();
    await vad.process(frame());
    // reset 후 호출(인덱스 1)의 h는 다시 영벡터여야 한다.
    expect(Array.from(calls[1].h.data).every((v) => v === 0)).toBe(true);
  });

  it("exposes lastProb for diagnostics", async () => {
    const { session } = makeFakeSession([0.42]);
    const vad = new SileroVad(session, FakeTensorCtor);
    await vad.process(frame());
    expect(vad.lastProb).toBeCloseTo(0.42, 5);
  });
});

describe("vadConfig.chunkerOptsFromAudioConfig", () => {
  it("maps config.yaml audio defaults to ChunkerOpts", () => {
    const opts = chunkerOptsFromAudioConfig(DEFAULT_AUDIO_CONFIG);
    expect(opts.sampleRate).toBe(16000);
    expect(opts.minSilenceMs).toBe(500); // silence_duration_ms
    expect(opts.minSegmentS).toBe(2); // min_chunk_sec
    expect(opts.prerollMs).toBe(500); // preroll_ms
    expect(opts.overlapMs).toBe(500); // overlap_ms
    expect(opts.maxSilenceMs).toBe(MAX_SILENCE_MS); // config 외 정책값
  });

  it("clamps maxSegmentS to Cohere 8s cap (max_chunk_sec=10 → 8)", () => {
    const opts = chunkerOptsFromAudioConfig(DEFAULT_AUDIO_CONFIG);
    expect(opts.maxSegmentS).toBe(8);
  });

  it("respects a smaller max_chunk_sec below the cap", () => {
    const cfg: AudioConfig = { ...DEFAULT_AUDIO_CONFIG, max_chunk_sec: 5 };
    expect(chunkerOptsFromAudioConfig(cfg).maxSegmentS).toBe(5);
  });

  it("uses DEFAULT_AUDIO_CONFIG when called with no args", () => {
    const opts = chunkerOptsFromAudioConfig();
    expect(opts.sampleRate).toBe(16000);
    expect(opts.maxSegmentS).toBe(8);
  });
});
