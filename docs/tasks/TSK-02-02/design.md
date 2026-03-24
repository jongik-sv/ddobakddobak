# TSK-02-02: whisper.cpp Adapter 구현 - 설계

## 구현 방향
pywhispercpp Python 바인딩을 통해 whisper.cpp large-v3-turbo 모델을 SttAdapter로 래핑한다.
STT_ENGINE=whisper_cpp 환경 변수로 Qwen3 대신 whisper.cpp 엔진을 선택 가능하다.
Qwen3Adapter와 동일한 출력 형식(TranscriptSegment)을 보장한다.

## 파일 계획
| 파일 경로 | 역할 | 신규/수정 |
|---|---|---|
| sidecar/app/stt/whisper_adapter.py | WhisperAdapter 구현 | 신규 |
| sidecar/app/stt/factory.py | whisper_cpp 엔진 라우팅 추가 | 수정 |
| sidecar/tests/test_whisper_adapter.py | WhisperAdapter 단위 테스트 | 신규 |

## 주요 구조
- `WhisperAdapter(SttAdapter)`: pywhispercpp Model 인스턴스 보유
- `load_model()`: pywhispercpp.model.Model 로드 (model_name=large-v3-turbo)
- `transcribe(audio_chunk)`: bytes→float32 → `_model.transcribe()` → TranscriptSegment 리스트
- `_run_inference(audio_array)`: model.transcribe() 호출 (테스트 mock 지점)
- factory: `engine == "whisper_cpp"` → `WhisperAdapter()` 반환

## 데이터 흐름
PCM bytes(16kHz Int16) → numpy float32 → pywhispercpp transcribe() → 세그먼트 파싱 → TranscriptSegment

## 선행 조건
- TSK-02-01 완료 (TranscriptSegment speaker_label 필드 포함)
- pywhispercpp 설치 (런타임 선택적 의존)
