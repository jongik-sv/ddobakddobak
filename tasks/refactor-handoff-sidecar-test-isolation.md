# [핸드오프] refactor/system-wide — sidecar 신규 테스트 격리 결함 진단

작성: 검증 세션(b996c990), 2026-08-08. `refactor/system-wide` 브랜치 전체 검증 중 발견.

## 검증 결과 요약
- 백엔드 rspec **2577/0 green**
- 프론트 tsc 0 · vite build 성공 · vitest **1989/1989 green**
- sidecar pytest **264 통과 / 9 실패** ← 이 문서의 대상

## 실패 증상
`tests/test_ws_transcribe.py`의 9개 테스트가 **전체 스위트 실행 시에만** 실패:
```
RuntimeError: There is no Stream(gpu, 1) in current thread.
  .venv/lib/python3.11/site-packages/mlx_lm/generate.py:438
```
단독 실행(`pytest tests/test_ws_transcribe.py`)하면 전부 통과.

## 원인 (이분 탐색으로 특정)
- `pytest tests/test_mlx_whisper_adapter.py tests/test_ws_transcribe.py` → 실패 재현
- `pytest tests/test_mlx_whisper_beam_adapter.py tests/test_ws_transcribe.py` → 12 passed (beam은 무해)

→ 신규 `tests/test_mlx_whisper_adapter.py`가 **MLX GPU 기본 스트림 전역 상태를 변경 후 복원하지 않음**. 이후 실행되는 ws_transcribe의 mlx_lm 추론이 다른 스레드 소속 스트림을 참조하며 사망.

## 수정 방향 (택1)
1. teardown/fixture에서 MLX 기본 스트림·디바이스 상태 복원 (`mx.set_default_stream(mx.default_stream(mx.default_device()))` 계열)
2. 스트림 만지는 테스트를 subprocess 격리(pytest-forked 또는 별도 프로세스 실행)
3. 해당 테스트가 자체 스트림을 만들지 않도록 어댑터 코드 쪽에서 스트림 사용을 명시 컨텍스트로 한정

## 완료 기준
```bash
cd sidecar && .venv/bin/python -m pytest -q   # 273 passed, 0 failed
```
순서 의존 없이 전체 스위트 green.
