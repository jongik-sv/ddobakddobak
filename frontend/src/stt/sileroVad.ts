// Silero VAD 로딩/프레임 처리. ondevice-stt useStt.ts에서 React 훅 의존을 제거하고
// VAD 부분만 순수 클래스/함수로 추출했다(T6).
//
// 구형 ONNX 입력계약(반드시 유지):
//   입력  x[1,512], h[2,1,64], c[2,1,64]  (sr 입력 없음)
//   출력  prob, new_h, new_c
//   → h/c LSTM 상태를 매 프레임 순환 갱신한다.
//   (신형 onnx-community input/sr/state→output/stateN 계약과 다름.)
//
// transformers.js는 오프라인 전용으로 고정한다: allowRemoteModels=false,
// allowLocalModels=true, localModelPath='/models/'. 모델은 빌드 시 vendoring된
// public/models/onnx-community/silero-vad/onnx/model.onnx 로컬 자산만 쓴다.
//
// 테스트성: 이 모듈(SileroVad 클래스 + 인터페이스)은 @huggingface/transformers를 일절
// 참조하지 않는다. 구조적 인터페이스(VadSession/TensorCtor)에만 의존하므로 단위테스트에서
// fake를 주입해 h/c 스레딩과 SPEECH/EXIT 히스테리시스를 검증할 수 있다.
// 실제 패키지는 별도 모듈 sileroVadLoader.ts(loadSileroVad)에서 동적 import로만 만진다 —
// 분리한 이유: vite의 import-analysis가 @vite-ignore 동적 import도 정적 해석하므로,
// 같은 모듈에 두면 미설치 상태에서 이 파일을 import하는 테스트가 수집 단계에서 깨진다.

/** silero 임계값(원본 useStt와 동일). prob > SPEECH면 발화 시작/유지, prob < EXIT면 종료. */
export const SPEECH_THRESHOLD = 0.3;
export const EXIT_THRESHOLD = 0.1;

/** silero가 기대하는 입력 프레임 크기(샘플). */
export const FRAME_SIZE = 512;

/** vendoring된 로컬 모델 경로(transformers from_pretrained 식별자). */
export const SILERO_MODEL_ID = "onnx-community/silero-vad";

/** transformers.js Tensor의 최소 구조(우리가 읽는 필드만). */
export interface VadTensor {
  data: ArrayLike<number>;
}

/** new Tensor("float32", data, dims) 시그니처의 최소 구조. */
export type TensorCtor = new (
  type: "float32",
  data: Float32Array,
  dims: number[],
) => VadTensor;

/** vad({x,h,c}) → {prob,new_h,new_c} 호출 가능한 세션의 최소 구조. */
export type VadSession = (inputs: {
  x: VadTensor;
  h: VadTensor;
  c: VadTensor;
}) => Promise<{ prob: VadTensor; new_h: VadTensor; new_c: VadTensor }>;

/**
 * Silero VAD 프레임 처리기. LSTM 상태(h,c)를 내부에 보관하며 프레임마다 순환 갱신한다.
 * silero state는 순차적으로 갱신돼야 하므로 process()는 직렬로 호출해야 한다
 * (동시 호출 시 state가 덮어써져 검출이 망가진다 — 원본 useStt의 drain 직렬화 불변식).
 */
export class SileroVad {
  private session: VadSession;
  private Tensor: TensorCtor;
  private h: VadTensor;
  private c: VadTensor;
  private recording = false;

  constructor(session: VadSession, Tensor: TensorCtor) {
    this.session = session;
    this.Tensor = Tensor;
    this.h = new Tensor("float32", new Float32Array(2 * 1 * 64), [2, 1, 64]);
    this.c = new Tensor("float32", new Float32Array(2 * 1 * 64), [2, 1, 64]);
  }

  /** h/c 상태와 recording 래치를 초기화한다(새 세션 시작용). */
  reset(): void {
    this.h = new this.Tensor("float32", new Float32Array(2 * 1 * 64), [2, 1, 64]);
    this.c = new this.Tensor("float32", new Float32Array(2 * 1 * 64), [2, 1, 64]);
    this.recording = false;
  }

  /** 마지막으로 계산한 발화 확률(디버그/관측용). */
  lastProb = 0;

  /**
   * 한 프레임(16k mono PCM)을 처리해 발화 여부를 반환한다.
   * h/c를 순환 갱신하고, prob에 SPEECH/EXIT 히스테리시스를 적용한다.
   */
  async process(frame: Float32Array): Promise<boolean> {
    const out = await this.session({
      x: new this.Tensor("float32", frame, [1, frame.length]),
      h: this.h,
      c: this.c,
    });
    this.h = out.new_h;
    this.c = out.new_c;
    const p = out.prob.data[0];
    this.lastProb = p;
    // 히스테리시스: 시작 임계값 SPEECH보다 높으면 발화, 녹음 중엔 EXIT 이상이면 유지.
    const speech = p > SPEECH_THRESHOLD || (this.recording && p >= EXIT_THRESHOLD);
    this.recording = speech || this.recording;
    if (!speech && p < EXIT_THRESHOLD) this.recording = false;
    return speech;
  }
}
