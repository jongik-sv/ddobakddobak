# 또박또박 Tauri 데스크톱 앱 전환 계획

> 작성일: 2026-03-27

## Context

또박또박(ddobakddobak)을 Tauri v2 기반 크로스 플랫폼 데스크톱 앱으로 전환합니다.

- **경량화 전략**: 시스템 Ruby/Python을 활용하여 번들 크기 **~25MB** 달성
- **크로스 플랫폼**: macOS, Windows, Linux 지원
- **내장 GPU 지원**: CPU 모드 폴백으로 NVIDIA 없이도 동작
- **작업 위치**: 현재 `ddobakddobak` 프로젝트에서 작업
- **백업**: 작업 전 현재 상태를 `ddobak` 프로젝트로 복사

---

## Tauri vs Electron 선택 근거

시스템 Ruby/Python 활용 방식에서 번들에 포함되는 것은 셸+프론트엔드+ffmpeg뿐입니다.

| 기준 | Tauri v2 | Electron |
|------|----------|----------|
| 번들 크기 | **~25MB** | ~140MB |
| 메모리 오버헤드 | ~60-100MB | ~250-430MB |
| WebView | WKWebView (MediaRecorder mp4 폴백 필요) | Chromium (그대로 동작) |
| 개발 언어 | Rust ~200줄 필요 | JS만 |
| 자동 업데이트 | 델타 패치 지원 | 전체 교체 |

**결정: Tauri** — 25MB vs 140MB 차이가 크고, MediaRecorder 폴백은 2줄 수정으로 해결 가능. Rust 코드는 기존 가이드(`docs/tauri-desktop-app-guide.md`) 템플릿 활용.

---

## 아키텍처

```
ddobakddobak.app / .exe / .AppImage (~25MB)
├── Tauri shell (Rust) — 프로세스 오케스트레이션
├── Frontend (React/Vite → WebView)
└── (시스템 런타임 활용)
      ├── Ruby + Rails (시스템 ruby + bundle install)
      ├── Python + Sidecar (시스템 uv + uv sync)
      └── ffmpeg (시스템 설치 또는 자동 설치)

데이터 디렉토리 (OS별):
  macOS:   ~/Library/Application Support/ddobakddobak/
  Windows: %APPDATA%/ddobakddobak/
  Linux:   ~/.local/share/ddobakddobak/
  ├── db/production.sqlite3
  ├── models/qwen3-asr-1.7b/     (~1GB, 첫 실행 다운로드)
  ├── models/pyannote/            (~300MB, macOS/NVIDIA만)
  └── audio/                      (녹음 파일)
```

---

## 크로스 플랫폼 STT 엔진 + 화자 분리 전략

STT Adapter 패턴(`sidecar/app/stt/factory.py`)으로 플랫폼별 최적 엔진을 자동 선택합니다.

| 플랫폼 | STT 엔진 | 가속 | 화자 분리 | 실시간 지연 |
|--------|----------|------|----------|-----------|
| macOS Apple Silicon | Qwen3-ASR (mlx-audio) | Metal GPU | pyannote (CPU/Metal) | ~2-3초 |
| macOS Intel | whisper.cpp | CPU | pyannote (CPU) | ~5-8초 |
| Windows/Linux + NVIDIA | faster-whisper | CUDA | pyannote (CUDA) | ~2-3초 |
| Windows/Linux + 내장 GPU | whisper.cpp | CPU | **비활성화** | ~5-8초 |

> **Windows/Linux 내장 GPU 환경에서는 pyannote 화자 분리를 비활성화합니다.**
> pyannote는 torch 기반이라 내장 GPU CPU 모드에서 너무 느려 실시간 처리가 불가능합니다.
> 이 경우 화자 구분 없이 STT만 동작합니다.

**자동 감지 로직:**
```python
import sys, platform

def auto_select_engine() -> str:
    if sys.platform == "darwin" and platform.machine() == "arm64":
        return "qwen3_asr_8bit"  # mlx-audio (Metal)
    if torch.cuda.is_available():
        return "faster_whisper"  # CUDA
    return "whisper_cpp"  # CPU 폴백

def should_enable_diarization() -> bool:
    """화자 분리 사용 가능 여부 판단."""
    if sys.platform == "darwin":
        return True  # macOS는 항상 사용 가능 (Metal/CPU)
    if torch.cuda.is_available():
        return True  # NVIDIA GPU 있으면 사용 가능
    return False  # Windows/Linux 내장 GPU → 비활성화
```

---

## Phase 0. 백업

1. 현재 `ddobakddobak` 상태를 `/Users/jji/project/ddobak`으로 복사
2. `ddobak` GitHub repo 생성 및 push (백업)

---

## Phase 1. Tauri 프로젝트 초기화

**작업:**
- Rust toolchain 확인/설치 (`rustup`)
- `frontend/` 내에서 Tauri v2 초기화 (`npx tauri init`)
- Tauri 의존성 설치
  - `@tauri-apps/api`
  - `@tauri-apps/plugin-shell`
  - `@tauri-apps/plugin-fs`
- `tauri.conf.json` 설정 (앱 이름, 윈도우, 번들 식별자)

**생성/수정 파일:**
- `frontend/src-tauri/` — Tauri Rust 프로젝트 (자동 생성)
- `frontend/src-tauri/tauri.conf.json` — 앱 설정
- `frontend/src-tauri/Cargo.toml` — Rust 의존성
- `frontend/package.json` — Tauri 의존성 추가

---

## Phase 2. 프로세스 오케스트레이션 (Rust)

앱 시작 시 환경 확인 → 의존성 설치 → 서비스 기동을 관리합니다.

**시작 플로우:**
```
앱 시작
  ├─ 1) 환경 확인
  │     ├─ ruby 존재? → 없으면 설치 안내 화면
  │     ├─ uv 존재? → 없으면 자동 설치 (curl)
  │     └─ ffmpeg 존재? → 없으면 설치 안내
  ├─ 2) 첫 실행 감지 (appData/db/ 없음)
  │     ├─ bundle install (Rails 의존성)
  │     ├─ uv sync (Python 의존성)
  │     ├─ rails db:create db:migrate (DB 초기화)
  │     └─ ML 모델 다운로드 진행률 UI (~1.3GB)
  ├─ 3) 플랫폼 감지 → STT 엔진/화자 분리 자동 설정
  ├─ 4) Rails 서버 spawn (port 3001)
  ├─ 5) Sidecar spawn (port 8000)
  ├─ 6) Health check 폴링 → 준비 완료
  └─ 7) WebView에 프론트엔드 로드
앱 종료
  └─ Rails + Sidecar 프로세스 kill + cleanup
```

**크로스 플랫폼 경로 처리:**
- `app.path().app_data_dir()` — Tauri가 OS별 자동 해결
- DB_PATH, MODELS_DIR, AUDIO_DIR 모두 이 경로 하위

**생성/수정 파일:**
- `frontend/src-tauri/src/lib.rs` — 프로세스 오케스트레이션
- `frontend/src-tauri/src/main.rs` — Tauri 엔트리포인트

**참고:** `docs/tauri-desktop-app-guide.md` Phase 4의 Rust 코드 템플릿 활용

---

## Phase 3. Frontend 수정

### 3-1. API URL Tauri 환경 분기

`frontend/src/config.ts`:
```typescript
const isTauri = '__TAURI_INTERNALS__' in window

export const API_BASE_URL = isTauri
  ? 'http://127.0.0.1:3001/api/v1'
  : config.api.base_url

export const WS_URL = isTauri
  ? 'ws://127.0.0.1:3001/cable'
  : config.api.ws_url
```

### 3-2. MediaRecorder 폴백 (WKWebView 대응)

`frontend/src/hooks/useAudioRecorder.ts`:
```typescript
// 기존: webm/opus만 시도
// 수정: mp4 폴백 추가 (macOS WKWebView용)
const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
  ? 'audio/webm;codecs=opus'
  : MediaRecorder.isTypeSupported('audio/mp4')
    ? 'audio/mp4'
    : ''
```

### 3-3. 셋업 UI (첫 실행 화면)

`frontend/src/pages/SetupPage.tsx` — 새 파일:
- 환경 확인 상태 표시 (ruby, uv, ffmpeg 체크 아이콘)
- 의존성 설치 진행률 바
- 모델 다운로드 진행률 바
- 완료 후 메인 화면으로 전환

`frontend/src/App.tsx` — 셋업 완료 여부 분기 추가

---

## Phase 4. Backend/Sidecar 경로 외부화 + 크로스 플랫폼

### Backend
- `backend/config/database.yml` — `DB_PATH` 환경변수 지원 추가
- 오디오 저장 경로 환경변수화 (`AUDIO_DIR`)

### Sidecar
- `sidecar/app/config.py` — `MODELS_DIR` 환경변수 추가
- `sidecar/app/stt/factory.py` — 플랫폼 자동 감지 + 엔진/화자분리 자동 선택
  - `auto_select_engine()` — OS/GPU 감지하여 최적 STT 엔진 반환
  - `should_enable_diarization()` — Windows/Linux 내장 GPU면 `False` 반환
- `sidecar/pyproject.toml` — 플랫폼별 optional dependencies 정리
  - macOS: `mlx-audio`, `mlx-lm` (Apple Silicon 전용)
  - Windows/Linux: `faster-whisper` (CUDA/CPU)
  - 공통: `pywhispercpp`, `pyannote-audio` (NVIDIA/macOS만 활성)

### ffmpeg
- `backend/app/controllers/api/v1/meetings_audio_controller.rb`에서 사용
- 시스템에 설치된 ffmpeg를 `which ffmpeg` / `where ffmpeg`로 확인
- 없으면 셋업 UI에서 설치 안내 (macOS: `brew`, Windows: `choco`, Linux: `apt`)

---

## Phase 5. 빌드 및 테스트

```bash
cd frontend

# 개발 모드 (Rails/Sidecar는 별도 터미널에서 실행)
npm run tauri dev

# 프로덕션 빌드
npm run tauri build
# macOS:   src-tauri/target/release/bundle/macos/ddobakddobak.app
#          src-tauri/target/release/bundle/dmg/ddobakddobak_x.x.x_aarch64.dmg
# Windows: src-tauri/target/release/bundle/msi/ddobakddobak_x.x.x_x64.msi
# Linux:   src-tauri/target/release/bundle/deb/ddobakddobak_x.x.x_amd64.deb
#          src-tauri/target/release/bundle/appimage/ddobakddobak_x.x.x_amd64.AppImage
```

**검증 항목:**
1. 첫 실행 → 환경 확인 → 의존성 설치 → 모델 다운로드 → 정상 기동
2. 마이크 녹음 → 라이브 기록 → AI 요약 전체 파이프라인
3. 앱 종료 → Rails/Sidecar 프로세스 정상 종료 (좀비 프로세스 없음)
4. 재실행 → 즉시 기동 (의존성 재설치 안함)
5. macOS: MediaRecorder mp4 폴백 동작 확인
6. Windows/Linux 내장 GPU: 화자 분리 비활성화 + whisper.cpp CPU 동작 확인
7. Windows/Linux NVIDIA: CUDA 가속 + pyannote 동작 확인

---

## 예상 결과물

| 항목 | 크기 |
|------|------|
| **DMG / MSI / AppImage** | **~25MB** |
| 첫 실행 시 설치 | Ruby gems ~200MB, Python venv ~2GB, ML 모델 ~1.3GB |
| 사용자 데이터 | OS별 appData 디렉토리 |

---

## 일정

| Phase | 내용 | 기간 |
|-------|------|------|
| Phase 0 | 백업 (ddobak 복사 + push) | 0.5일 |
| Phase 1 | Tauri 프로젝트 초기화 | 1일 |
| Phase 2 | 프로세스 오케스트레이션 (Rust) | 2-3일 |
| Phase 3 | Frontend 수정 (URL분기, MediaRecorder, 셋업UI) | 1-2일 |
| Phase 4 | Backend/Sidecar 경로 외부화 + 플랫폼 감지 | 1일 |
| Phase 5 | 빌드 및 테스트 (macOS 우선) | 2-3일 |
| **합계 (macOS)** | | **~8-10일** |
| 추가 | Windows/Linux 빌드 테스트 | ~2-3일 |

---

## 주의사항

- **코드 사이닝**: macOS 배포 시 Apple Developer 계정 필요 (notarization, $99/year)
- **Gatekeeper**: 서명 없이 배포 시 사용자가 직접 "열기" 허용 필요
- **포트 충돌**: 3001, 8000 포트 사용 중 여부 확인 로직 필요
- **ActionCable**: Tauri에서 `ws://127.0.0.1:3001/cable`로 WebSocket 연결
- **모델 업데이트**: 외부 디렉토리이므로 앱 업데이트 없이 모델만 교체 가능
- **Windows Ruby**: Windows에서 Ruby 설치는 RubyInstaller 필요 — 셋업 UI에서 안내
