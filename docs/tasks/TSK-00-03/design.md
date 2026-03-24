# TSK-00-03: Python Sidecar 프로젝트 초기화 - 설계 문서

**작성일:** 2026-03-24
**상태:** Design

---

## 1. 목표

FastAPI + uv 기반 Python Sidecar 프로젝트를 초기화하고, STT Adapter 패턴의 기반 구조를 구현한다.
실제 STT 모델(Qwen3, Whisper 등)은 이후 Task에서 구현하며, 이번 Task에서는 구조와 `/health` 엔드포인트에 집중한다.

---

## 2. 디렉토리 구조

```
sidecar/
├── app/
│   ├── main.py              # FastAPI 앱 진입점, /health 엔드포인트
│   ├── config.py            # 환경 변수 (STT_ENGINE, 포트 등)
│   └── stt/
│       ├── __init__.py
│       ├── base.py          # SttAdapter 추상 클래스, TranscriptSegment
│       ├── factory.py       # STT_ENGINE → Adapter 매핑 (Factory 패턴)
│       └── mock_adapter.py  # 테스트용 더미 STT 어댑터
├── tests/
│   ├── __init__.py
│   ├── test_health.py       # /health 엔드포인트 테스트
│   └── test_stt_factory.py  # STT Factory 패턴 테스트
├── pyproject.toml           # uv 프로젝트 설정
└── uv.lock                  # 의존성 잠금 파일
```

---

## 3. 핵심 설계 결정

### 3.1 SttAdapter 추상 클래스 (base.py)

TRD 4.3 명세를 따름:
- `TranscriptSegment` 데이터클래스: `text`, `started_at_ms`, `ended_at_ms`, `language`, `confidence`
- `SttAdapter` ABC: `load_model()`, `transcribe()`, `transcribe_stream()`, `transcribe_file()` 추상 메서드
- `is_loaded` 프로퍼티: 모델 로드 상태 확인용 (health 엔드포인트에서 활용)

### 3.2 STT Factory 패턴 (factory.py)

- `create_stt_adapter(engine: str = None) -> SttAdapter`: 환경 변수 `STT_ENGINE` 또는 인자로 엔진 선택
- 지원 엔진 목록: `qwen3_asr`, `whisper_cpp`, `faster_whisper`, `sensevoice`, `mock`
- 알 수 없는 엔진 요청 시 `ValueError` 발생
- 기본값: `mock` (개발/테스트 환경에서 실제 모델 없이 동작 가능)

### 3.3 MockAdapter (mock_adapter.py)

- 실제 모델 없이 더미 응답을 반환하는 테스트용 어댑터
- `load_model()`: 즉시 완료 (no-op)
- `transcribe()`: 더미 `TranscriptSegment` 반환
- `transcribe_stream()`: 더미 세그먼트 1개를 yield
- `transcribe_file()`: 더미 세그먼트 1개 반환

### 3.4 /health 엔드포인트 (main.py)

TRD 4.4 명세:
```
GET /health → { status, stt_engine, model_loaded }
```
- `status`: `"ok"` (항상)
- `stt_engine`: 현재 설정된 STT_ENGINE 환경 변수 값
- `model_loaded`: 어댑터의 `is_loaded` 상태

### 3.5 config.py

Pydantic `BaseSettings`를 사용해 환경 변수 로드:
- `STT_ENGINE`: STT 엔진 선택 (기본값: `"mock"`)
- `HOST`: 서버 바인딩 호스트 (기본값: `"0.0.0.0"`)
- `PORT`: 서버 포트 (기본값: `8000`)

---

## 4. 의존성

| 패키지 | 버전 | 용도 |
|--------|------|------|
| fastapi | 최신 | 웹 프레임워크 |
| uvicorn[standard] | 최신 | ASGI 서버 |
| pydantic-settings | 최신 | 환경 변수 관리 |
| pytest | 최신 | 테스트 |
| httpx | 최신 | 테스트 클라이언트 (TestClient) |

---

## 5. 테스트 계획

### test_health.py
- `GET /health` 응답 상태 코드 200
- 응답 JSON에 `status`, `stt_engine`, `model_loaded` 필드 존재
- `status` 값이 `"ok"`
- `stt_engine` 값이 설정된 값과 일치

### test_stt_factory.py
- `create_stt_adapter("mock")` → `MockAdapter` 인스턴스 반환
- 알 수 없는 엔진 → `ValueError` 발생
- `MockAdapter.transcribe()` → `TranscriptSegment` 리스트 반환
- `MockAdapter.is_loaded` 초기값 `False`, `load_model()` 후 `True`

---

## 6. 실행 방법

```bash
cd sidecar
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

테스트:
```bash
cd sidecar
uv run pytest
```
