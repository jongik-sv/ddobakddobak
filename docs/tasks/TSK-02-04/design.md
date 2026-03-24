# TSK-02-04: STT WebSocket 스트리밍 엔드포인트 - 설계

## 구현 방향
FastAPI WebSocket 엔드포인트로 실시간 PCM 오디오를 수신하고,
STT(SttAdapter) + 화자 분리(SpeakerDiarizer)를 순차 실행한 후
partial/final 구분된 JSON 메시지를 클라이언트에 전송한다.
REST POST /transcribe도 함께 구현하여 배치 변환을 지원한다.

## 파일 계획
| 파일 경로 | 역할 | 신규/수정 |
|---|---|---|
| sidecar/app/main.py | WS /ws/transcribe, POST /transcribe 엔드포인트 추가 | 수정 |
| sidecar/tests/test_ws_transcribe.py | WebSocket 엔드포인트 통합 테스트 | 신규 |
| sidecar/tests/test_transcribe_endpoint.py | POST /transcribe 단위 테스트 | 신규 |

## 주요 구조
- `POST /transcribe`: base64 audio 수신 → STT → TranscriptSegment 리스트 JSON 반환
- `WS /ws/transcribe`: binary PCM 수신 루프 → STT → diarize → final JSON 전송
- `TranscribeRequest/Response` Pydantic 모델: 요청/응답 스키마
- `WsMessage` TypedDict: `{type, text, speaker, started_at_ms, ended_at_ms, seq}`
- lifespan 확장: SpeakerDiarizer도 app.state에 보관

## 데이터 흐름
WS binary PCM → STT adapter.transcribe() → SpeakerDiarizer.merge_with_segments() → JSON {type:final, text, speaker, ...} 전송

## 선행 조건
- TSK-02-01 완료 (SttAdapter, TranscriptSegment)
- TSK-02-03 완료 (SpeakerDiarizer)
