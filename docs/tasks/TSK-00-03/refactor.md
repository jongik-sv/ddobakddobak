# TSK-00-03: 리팩토링 리포트

**실행일:** 2026-03-24

---

## 리팩토링 대상 및 개선 내용

### 1. main.py: 전역 변수 → `app.state` 패턴

**변경 전:**
```python
_stt_adapter = None  # 모듈 수준 전역 변수

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _stt_adapter
    _stt_adapter = create_stt_adapter()
    ...
```

**변경 후:**
```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.stt_adapter = create_stt_adapter()
    ...
```

**이유:**
- FastAPI의 권장 패턴(`app.state`)을 따라 어댑터 생명주기를 앱 인스턴스에 귀속
- `global` 키워드 제거로 코드 가독성 향상
- 테스트 시 TestClient가 독립적인 앱 인스턴스를 생성하므로 상태 격리가 보장됨

### 2. main.py: `HealthResponse` Pydantic 모델 추가

**변경 전:**
```python
@app.get("/health")
async def health():
    return {"status": "ok", "stt_engine": ..., "model_loaded": ...}
```

**변경 후:**
```python
class HealthResponse(BaseModel):
    status: str
    stt_engine: str
    model_loaded: bool

@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    ...
```

**이유:**
- 응답 스키마가 명시적으로 문서화됨 (FastAPI 자동 생성 OpenAPI 스펙에 반영)
- 반환 타입 힌팅으로 IDE 지원 개선
- 런타임에 응답 타입 검증 적용

### 3. factory.py: `_KNOWN_ENGINES` 모듈 레벨 상수화

**변경 전:**
```python
def create_stt_adapter(engine):
    _KNOWN_ENGINES = {"qwen3_asr", ...}  # 함수 호출마다 재생성
    ...
```

**변경 후:**
```python
_KNOWN_ENGINES: frozenset[str] = frozenset({"qwen3_asr", ...})  # 모듈 로드 시 1회 생성

def create_stt_adapter(engine):
    ...
```

**이유:**
- 함수 호출마다 `set` 객체를 재생성하는 불필요한 비용 제거
- `frozenset`으로 변경하여 불변성(immutability) 명시
- 타입 힌팅으로 의도 명확화

---

## 리팩토링 후 테스트 결과

```
15 passed in 0.17s
```

전체 15개 테스트 통과 (변경 없음)

---

## 코드 품질 체크리스트

| 항목 | 결과 |
|------|------|
| 모든 public 함수/클래스에 docstring 작성 | O |
| 타입 힌팅 적용 | O |
| 전역 상태 최소화 | O (app.state로 이동) |
| 불변 상수 frozenset 사용 | O |
| Pydantic 응답 모델 정의 | O |
| ABC 추상 메서드 인터페이스 명확화 | O |
