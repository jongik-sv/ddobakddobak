# TSK-08-01: 크로스 플랫폼 STT 엔진 자동 선택 - 설계 문서

**작성일:** 2026-03-27
**상태:** Design

---

## 1. 목표

Windows/Linux 환경에서도 STT가 정상 동작하도록 `FasterWhisperAdapter`를 구현하고,
플랫폼별 의존성을 분리하여 각 OS에서 필요한 패키지만 설치되도록 한다.

---

## 2. 현재 상태 분석

### 2.1 구현된 어댑터

| 어댑터 | 파일 | 플랫폼 | 상태 |
|--------|------|--------|------|
| MockAdapter | `mock_adapter.py` | 전체 | 완료 |
| WhisperAdapter | `whisper_adapter.py` | 전체 (CPU) | 완료 |
| Qwen3Adapter | `qwen3_adapter.py` | macOS Apple Silicon | 완료 |
| FasterWhisperAdapter | ❌ 없음 | CUDA (Windows/Linux) | **미구현** |

### 2.2 문제점

1. **FasterWhisperAdapter 미구현**: `factory.py`에서 `faster_whisper`를 `_KNOWN_ENGINES`에 등록했지만 `NotImplementedError` 발생
2. **의존성 하드코딩**: `pyproject.toml`에 `mlx-audio`, `pywhispercpp`가 필수 의존성 → Windows/Linux에서 `mlx-audio` 설치 실패
3. **기본값 문제**: `config.py`의 `STT_ENGINE` 기본값이 `qwen3_asr_8bit` → macOS 전용

---

## 3. 설계

### 3.1 FasterWhisperAdapter 구현

**파일:** `sidecar/app/stt/faster_whisper_adapter.py`

```python
class FasterWhisperAdapter(SttAdapter):
    """faster-whisper (CTranslate2) 기반 STT Adapter.

    NVIDIA GPU(CUDA) 환경에서 최적 성능.
    CPU에서도 동작하나 whisper.cpp보다 느릴 수 있음.
    """
```

**핵심 구현:**
- 모델: `large-v3-turbo` (WhisperAdapter와 동일 모델, 다른 런타임)
- `load_model()`: `faster_whisper.WhisperModel` 로드, CUDA 자동 감지 (`device="auto"`)
- `transcribe()`: PCM bytes → float32 변환 → `model.transcribe()` 호출
- `transcribe_file()`: faster-whisper는 파일 경로 직접 입력 지원 (더 효율적)
- 환각 필터: WhisperAdapter의 `_is_hallucination()` 로직 재사용

**WhisperAdapter와의 차이:**

| 항목 | WhisperAdapter | FasterWhisperAdapter |
|------|---------------|---------------------|
| 런타임 | whisper.cpp (C++) | CTranslate2 (C++) |
| Python 바인딩 | pywhispercpp | faster-whisper |
| GPU 가속 | Metal (macOS) | CUDA (NVIDIA) |
| CPU 폴백 | 지원 | 지원 |
| VAD | 없음 | Silero VAD 내장 |

### 3.2 factory.py 수정

`create_stt_adapter()`에 `faster_whisper` 분기 추가:

```python
if engine == "faster_whisper":
    from app.stt.faster_whisper_adapter import FasterWhisperAdapter
    return FasterWhisperAdapter()
```

### 3.3 pyproject.toml 플랫폼별 의존성 분리

**변경 전:**
```toml
dependencies = [
    "mlx-audio>=0.4.1",      # macOS Apple Silicon 전용
    "mlx-lm>=0.31.1",        # macOS Apple Silicon 전용
    "pywhispercpp>=1.4.1",   # 크로스 플랫폼이지만 macOS 주 사용
    "pyannote-audio>=4.0.4", # 전체 플랫폼
]
```

**변경 후:**
```toml
dependencies = [
    "anthropic>=0.40.0",
    "fastapi>=0.135.2",
    "numpy>=1.26.0",
    "pydantic-settings>=2.13.1",
    "uvicorn>=0.42.0",
]

[project.optional-dependencies]
# macOS Apple Silicon: MLX 기반 Qwen3-ASR
macos = [
    "mlx-audio>=0.4.1",
    "mlx-lm>=0.31.1",
    "pywhispercpp>=1.4.1",
    "pyannote-audio>=4.0.4",
]
# Windows/Linux NVIDIA GPU: faster-whisper + CUDA
cuda = [
    "faster-whisper>=1.1.0",
    "pyannote-audio>=4.0.4",
]
# Windows/Linux CPU 전용: whisper.cpp만
cpu = [
    "pywhispercpp>=1.4.1",
]
```

**설치 명령:**
```bash
# macOS Apple Silicon
uv sync --extra macos

# NVIDIA GPU (Windows/Linux)
uv sync --extra cuda

# CPU 전용 (Windows/Linux)
uv sync --extra cpu
```

### 3.4 config.py 기본값 변경

```python
STT_ENGINE: str = "auto"  # 기존: "qwen3_asr_8bit"
```

`auto` 모드에서 `factory.py`의 `auto_select_engine()`이 플랫폼 감지 후 최적 엔진 선택.

### 3.5 auto_select_engine() 로직 (변경 없음)

현재 `factory.py`의 자동 감지 로직은 이미 올바름:

```
macOS ARM64 → qwen3_asr_8bit (mlx-audio)
CUDA 사용 가능 → faster_whisper (CTranslate2)
그 외 → whisper_cpp (CPU 폴백)
```

---

## 4. 파일 변경 목록

| 파일 | 변경 유형 | 설명 |
|------|----------|------|
| `sidecar/app/stt/faster_whisper_adapter.py` | **신규** | FasterWhisperAdapter 구현 |
| `sidecar/app/stt/factory.py` | 수정 | faster_whisper 분기 연결 |
| `sidecar/app/config.py` | 수정 | STT_ENGINE 기본값 → `"auto"` |
| `sidecar/pyproject.toml` | 수정 | 플랫폼별 optional-dependencies 분리 |

---

## 5. 테스트 계획

### 5.1 단위 테스트

- `test_faster_whisper_adapter.py`
  - `FasterWhisperAdapter` 인스턴스 생성
  - `load_model()` 전 `is_loaded == False`
  - `transcribe()` 로드 전 호출 시 `RuntimeError`
  - (faster-whisper 설치된 환경) 실제 모델 로드 및 변환 테스트

- `test_stt_factory.py` 확장
  - `create_stt_adapter("faster_whisper")` → `FasterWhisperAdapter` 반환
  - `auto_select_engine()` 반환값이 유효한 엔진명인지 확인

### 5.2 통합 테스트

- 각 플랫폼에서 `STT_ENGINE=auto`로 실행하여 올바른 엔진 선택 확인
- 해당 라이브러리 미설치 시 명확한 에러 메시지 출력 확인

---

## 6. 의존성 매트릭스

| 패키지 | macOS | cuda | cpu | 용도 |
|--------|-------|------|-----|------|
| mlx-audio | ✅ | - | - | Qwen3-ASR (Metal) |
| mlx-lm | ✅ | - | - | MLX 모델 로딩 |
| pywhispercpp | ✅ | - | ✅ | whisper.cpp 바인딩 |
| faster-whisper | - | ✅ | - | CTranslate2 Whisper |
| pyannote-audio | ✅ | ✅ | - | 화자 분리 |
| numpy | ✅ | ✅ | ✅ | 오디오 데이터 처리 |
