# TSK-02-03: 리팩토링 내역

## 변경 사항
| 파일 | 변경 내용 |
|---|---|
| sidecar/app/diarization/speaker.py | `get_event_loop()` → `get_running_loop()` (Python 3.10+ 권장 방식) |

## 테스트 확인
- 결과: PASS
- 전체 68/68 통과
