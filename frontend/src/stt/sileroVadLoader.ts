// 번들된 silero ONNX를 오프라인으로 로드해 SileroVad를 만든다.
//
// @huggingface/transformers는 이 모듈에서만 참조한다(정적 import). 이 의존은 통합 시점에
// 메인스레드가 package.json에 추가한다 — T6 시점엔 미설치라 tsc(@ts-ignore)와 vitest 모두
// 이 파일을 만지지 않아야 green이다. SileroVad 클래스/인터페이스는 sileroVad.ts에 분리돼
// 있어 단위테스트는 그쪽만 import한다.
//
// 분리 이유: vite의 import-analysis는 @vite-ignore 동적 import도 정적 해석하므로,
// 로더를 sileroVad.ts에 두면 그 파일을 import하는 테스트가 미설치 의존 때문에 수집 단계에서
// 깨진다(empirically 확인). 따라서 실제 패키지 참조를 별도 모듈로 격리한다.
import { SileroVad, SILERO_MODEL_ID, type VadSession, type TensorCtor } from "./sileroVad";

/**
 * 번들된 silero ONNX를 오프라인으로 로드해 SileroVad를 만든다.
 * transformers.js를 오프라인 전용으로 고정: allowRemoteModels=false, allowLocalModels=true,
 * localModelPath='/models/'. 모델은 public/models/onnx-community/silero-vad/onnx/model.onnx.
 */
export async function loadSileroVad(): Promise<SileroVad> {
  // @ts-ignore — 통합 시 추가될 의존(미설치 상태에서 tsc green 유지). @ts-expect-error 금지.
  const { AutoModel, Tensor, env } = await import("@huggingface/transformers");
  // 오프라인 전용 고정(from_pretrained 호출 전에 반드시 설정).
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = "/models/";
  const session = (await AutoModel.from_pretrained(SILERO_MODEL_ID, {
    config: { model_type: "custom" },
    dtype: "fp32",
  })) as unknown as VadSession;
  return new SileroVad(session, Tensor as unknown as TensorCtor);
}
