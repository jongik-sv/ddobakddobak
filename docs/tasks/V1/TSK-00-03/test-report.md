# TSK-00-03: 테스트 리포트

**실행일:** 2026-03-24
**시도 횟수:** 1회 (최초 실행에 전체 통과)

---

## 테스트 결과 요약

| 항목 | 결과 |
|------|------|
| 총 테스트 수 | 15 |
| 통과 | 15 |
| 실패 | 0 |
| 에러 | 0 |
| 실행 시간 | 0.10s |

---

## 테스트 상세

### test_health.py (5개)

| 테스트 | 결과 |
|--------|------|
| `test_health_returns_200` | PASSED |
| `test_health_response_has_required_fields` | PASSED |
| `test_health_status_is_ok` | PASSED |
| `test_health_model_loaded_is_bool` | PASSED |
| `test_health_stt_engine_is_string` | PASSED |

### test_stt_factory.py (10개)

| 테스트 | 결과 |
|--------|------|
| `test_create_mock_adapter_returns_mock_instance` | PASSED |
| `test_create_adapter_with_unknown_engine_raises_value_error` | PASSED |
| `test_mock_adapter_is_loaded_initially_false` | PASSED |
| `test_mock_adapter_load_model_sets_is_loaded_true` | PASSED |
| `test_mock_adapter_transcribe_returns_list` | PASSED |
| `test_mock_adapter_transcribe_segment_has_text` | PASSED |
| `test_mock_adapter_transcribe_file_returns_list` | PASSED |
| `test_mock_adapter_transcribe_stream_yields_segments` | PASSED |
| `test_transcript_segment_fields` | PASSED |
| `test_transcript_segment_default_values` | PASSED |

---

## 수동 검증 (서버 기동)

```bash
cd sidecar && uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
curl http://localhost:8000/health
```

응답:
```json
{
    "status": "ok",
    "stt_engine": "mock",
    "model_loaded": true
}
```

- HTTP 200 OK 확인
- `status: "ok"` 확인
- `stt_engine: "mock"` (기본값) 확인
- `model_loaded: true` (lifespan에서 load_model() 호출 후) 확인

---

## Acceptance Criteria 달성 여부

| 기준 | 달성 |
|------|------|
| `uv run uvicorn app.main:app` 정상 기동 | O |
| `/health` 응답 정상 (`status`, `stt_engine`, `model_loaded` 포함) | O |
| `uv run pytest` 전체 통과 | O |
