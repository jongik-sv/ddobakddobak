# TSK-02-01: Qwen3-ASR Adapter 구현 - 설계

## 구현 방향
vLLM 기반 Qwen3-ASR-1.7B 모델을 SttAdapter 인터페이스로 래핑한다.
PCM 16kHz Int16 bytes → numpy float32 변환 후 vLLM 추론 → TranscriptSegment 반환.
vLLM을 lazy import하여 모듈 미설치 시 ImportError를 명확히 안내한다.
테스트 시 `_llm` 인스턴스 직접 mock으로 교체 가능한 구조를 유지한다.

## 파일 계획
| 파일 경로 | 역할 | 신규/수정 |
|---|---|---|
| sidecar/app/stt/base.py | TranscriptSegment에 speaker_label 필드 추가 | 수정 |
| sidecar/app/stt/qwen3_adapter.py | Qwen3Adapter 구현 | 신규 |
| sidecar/app/stt/factory.py | qwen3_asr 엔진 라우팅 추가 | 수정 |
| sidecar/tests/test_qwen3_adapter.py | Qwen3Adapter 단위 테스트 | 신규 |

## 주요 구조
- `Qwen3Adapter(SttAdapter)`: vLLM LLM 인스턴스 보유, load_model/transcribe/transcribe_stream/transcribe_file 구현
- `load_model()`: vllm.LLM 로드, run_in_executor로 blocking 호출 비동기화
- `transcribe(audio_chunk)`: bytes→float32 변환 → `_run_inference()` → TranscriptSegment 생성
- `_run_inference(audio_array)`: `self._llm.generate()` 호출 (테스트 시 mock 교체 지점)
- factory: `engine == "qwen3_asr"` → `Qwen3Adapter()` 반환

## 데이터 흐름
PCM bytes(16kHz Int16) → numpy float32 배열 → vLLM generate() → 텍스트 파싱 → TranscriptSegment

## 선행 조건
- TSK-00-03 완료 (SttAdapter ABC, factory 기반 구조)
- vLLM 설치 (런타임 선택적 의존, 미설치 시 ImportError 안내)
