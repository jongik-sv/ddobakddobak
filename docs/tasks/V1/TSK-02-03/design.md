# TSK-02-03: pyannote 화자 분리 구현 - 설계

## 구현 방향
pyannote.audio 3.x Pipeline을 사용하여 오디오에서 화자를 분리하고,
STT 결과 TranscriptSegment의 시간 범위와 diarization 결과를 매핑하여 speaker_label을 부여한다.
HF_TOKEN 환경 변수로 Hugging Face 인증을 처리한다.

## 파일 계획
| 파일 경로 | 역할 | 신규/수정 |
|---|---|---|
| sidecar/app/diarization/__init__.py | 패키지 초기화 | 신규 |
| sidecar/app/diarization/speaker.py | SpeakerDiarizer 구현 | 신규 |
| sidecar/app/config.py | HF_TOKEN 설정 추가 | 수정 |
| sidecar/tests/test_speaker_diarization.py | SpeakerDiarizer 단위 테스트 | 신규 |

## 주요 구조
- `SpeakerDiarizer`: pyannote Pipeline 보유, load/diarize/merge_with_segments 메서드
- `load(hf_token)`: Pipeline.from_pretrained() 로드
- `diarize(audio_bytes)`: PCM bytes → dict → pipeline() → {(start_ms, end_ms): speaker} 반환
- `merge_with_segments(segments, diarization)`: TranscriptSegment 리스트에 speaker_label 병합
- `_find_speaker(start_ms, end_ms, diarization)`: 시간 겹침으로 화자 매핑

## 데이터 흐름
PCM bytes → pyannote pipeline() → {(start_ms, end_ms): "SPEAKER_00"} → TranscriptSegment.speaker_label 병합

## 선행 조건
- TSK-00-03 완료 (TranscriptSegment 기반 구조)
- pyannote.audio 설치 (런타임 의존)
- HF_TOKEN 환경 변수 (Hugging Face 접근용)
