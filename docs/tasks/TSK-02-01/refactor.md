# TSK-02-01: 리팩토링 내역

## 변경 사항
| 파일 | 변경 내용 |
|---|---|
| sidecar/app/stt/qwen3_adapter.py | `load_model` 중복 import 제거 (try 블록 단일화) |
| sidecar/app/stt/qwen3_adapter.py | `get_event_loop()` → `get_running_loop()` (Python 3.10+ 권장 방식) |

## 테스트 확인
- 결과: PASS
- 전체 68/68 통과
