# Tauri 데스크탑 앱 전환 가이드

## 개요

ddobakddobak을 Tauri 기반 macOS 데스크탑 앱으로 전환하는 가이드입니다.
현재 3개의 독립 프로세스(Frontend, Backend, Sidecar)를 하나의 앱 번들로 패키징합니다.

### 목표 아키텍처

```
ddobakddobak.app
├── Tauri shell (Rust)
│   └── 프로세스 오케스트레이션 (Rails, Sidecar 시작/종료)
├── Frontend (React/Vite → Tauri webview)
├── backend-server  (Rails standalone binary)
└── sidecar-server  (PyInstaller binary, 모델 제외)

~/Library/Application Support/ddobakddobak/
├── models/
│   ├── qwen3-asr-1.7b/       (~1GB, 첫 실행 시 다운로드)
│   └── pyannote/              (~300MB, 첫 실행 시 다운로드)
└── db/
    └── production.sqlite3
```

### 전제 조건

- macOS (Apple Silicon) 전용 앱
- Tauri v2
- Rust toolchain
- Node.js 20+
- Python 3.11 (PyInstaller용)
- Ruby 3.x (Rails binary 빌드용)

---

## Phase 1. Tauri 프로젝트 초기화

### 1-1. Tauri CLI 설치 및 프로젝트 생성

```bash
cargo install tauri-cli --version "^2"

# 기존 frontend 디렉토리 안에서 Tauri 초기화
cd frontend
npm install @tauri-apps/api @tauri-apps/plugin-shell @tauri-apps/plugin-fs
npx tauri init
```

`tauri init` 설정값:
- App name: `ddobakddobak`
- Window title: `또박또박`
- Frontend dist path: `../dist`
- Dev server URL: `http://localhost:5173`

### 1-2. 디렉토리 구조

```
frontend/
├── src-tauri/          ← Tauri Rust 코드
│   ├── src/
│   │   ├── main.rs
│   │   └── lib.rs      ← 프로세스 오케스트레이션 로직
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── binaries/       ← 번들할 외부 실행파일 위치
│       ├── backend-server-aarch64-apple-darwin
│       └── sidecar-server-aarch64-apple-darwin
```

### 1-3. tauri.conf.json 핵심 설정

```json
{
  "bundle": {
    "identifier": "com.ddobakddobak.app",
    "targets": ["dmg", "app"],
    "externalBin": [
      "binaries/backend-server",
      "binaries/sidecar-server"
    ],
    "resources": []
  },
  "plugins": {
    "shell": {
      "open": false,
      "sidecar": true
    },
    "fs": {
      "scope": ["$APPDATA/**", "$HOME/Library/Application Support/ddobakddobak/**"]
    }
  }
}
```

---

## Phase 2. Rails Backend 번들링

Rails 서버를 독립 실행 가능한 바이너리로 패키징합니다.

### 2-1. Standalone 실행 준비

`backend/bin/server` 스크립트 생성:

```bash
#!/usr/bin/env ruby
# Rails 서버를 지정 포트로 실행
require_relative '../config/environment'
require 'rack/handler/puma'

port = ENV.fetch('RAILS_PORT', 3001).to_i
Rack::Handler::Puma.run(Rails.application, Port: port, Host: '127.0.0.1')
```

### 2-2. 데이터베이스 경로를 외부 디렉토리로 변경

`backend/config/database.yml`:

```yaml
production:
  adapter: sqlite3
  database: <%= ENV.fetch('DB_PATH', Rails.root.join('storage/production.sqlite3')) %>
```

앱 실행 시 `DB_PATH`를 `~/Library/Application Support/ddobakddobak/db/production.sqlite3`로 설정합니다.

### 2-3. Ruby 런타임 포함 패키징

[ruby-packer](https://github.com/pmq20/ruby-packer) 또는 `traveling-ruby`를 사용합니다.

```bash
# traveling-ruby 방식 (권장)
# https://github.com/phusion/traveling-ruby

mkdir -p packaging/backend
# traveling-ruby 패키지 다운로드 후:
cp -r backend/ packaging/backend/app
cp traveling-ruby-*/runtime packaging/backend/ruby-runtime

# 실행 래퍼 스크립트 작성
cat > packaging/backend/run.sh << 'EOF'
#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/ruby-runtime/bin/ruby" "$DIR/app/bin/server" "$@"
EOF
chmod +x packaging/backend/run.sh
```

빌드 결과물을 `frontend/src-tauri/binaries/backend-server-aarch64-apple-darwin`으로 복사합니다.

---

## Phase 3. Python Sidecar 번들링

PyInstaller로 Python sidecar를 단일 실행파일로 패키징합니다.
**ML 모델은 포함하지 않습니다.**

### 3-1. PyInstaller 설치

```bash
cd sidecar
uv add --dev pyinstaller
```

### 3-2. 모델 경로를 환경변수로 분리

`sidecar/app/config.py`에서 모델 경로를 `MODELS_DIR` 환경변수로 읽도록 수정:

```python
class Settings(BaseSettings):
    models_dir: str = str(Path.home() / "Library/Application Support/ddobakddobak/models")

    @property
    def qwen3_model_path(self) -> str:
        return str(Path(self.models_dir) / "qwen3-asr-1.7b")

    @property
    def pyannote_model_path(self) -> str:
        return str(Path(self.models_dir) / "pyannote")
```

### 3-3. PyInstaller spec 파일 작성

`sidecar/sidecar.spec`:

```python
# -*- mode: python ; coding: utf-8 -*-

a = Analysis(
    ['app/main.py'],
    pathex=['.'],
    binaries=[],
    datas=[],
    hiddenimports=[
        'uvicorn.logging',
        'uvicorn.loops.auto',
        'uvicorn.protocols.http.auto',
        'pyannote.audio',
        'torch',
    ],
    hookspath=[],
    excludes=[
        # 모델 파일은 제외
    ],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    name='sidecar-server',
    debug=False,
    strip=True,
    upx=False,  # macOS에서 UPX 비권장
    console=False,
    target_arch='arm64',
)
```

```bash
cd sidecar
uv run pyinstaller sidecar.spec

# 결과물 복사
cp dist/sidecar-server \
  ../frontend/src-tauri/binaries/sidecar-server-aarch64-apple-darwin
```

> **주의**: torch + pyannote 포함 시 번들 크기 ~500MB 예상

---

## Phase 4. 프로세스 오케스트레이션 (Rust)

`frontend/src-tauri/src/lib.rs`:

```rust
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandChild;
use std::sync::Mutex;

struct AppState {
    backend: Mutex<Option<CommandChild>>,
    sidecar: Mutex<Option<CommandChild>>,
}

#[tauri::command]
async fn start_services(app: AppHandle) -> Result<(), String> {
    let data_dir = app.path().app_data_dir()
        .map_err(|e| e.to_string())?;

    let db_path = data_dir.join("db/production.sqlite3");
    let models_dir = data_dir.join("models");

    std::fs::create_dir_all(db_path.parent().unwrap()).ok();

    // Rails 서버 시작 (포트 3001)
    let backend = app.shell()
        .sidecar("backend-server")
        .map_err(|e| e.to_string())?
        .env("RAILS_ENV", "production")
        .env("RAILS_PORT", "3001")
        .env("DB_PATH", db_path.to_str().unwrap())
        .env("RAILS_LOG_TO_STDOUT", "1")
        .spawn()
        .map_err(|e| e.to_string())?;

    // Python sidecar 시작 (포트 8000)
    let sidecar = app.shell()
        .sidecar("sidecar-server")
        .map_err(|e| e.to_string())?
        .env("MODELS_DIR", models_dir.to_str().unwrap())
        .env("PORT", "8000")
        .spawn()
        .map_err(|e| e.to_string())?;

    let state = app.state::<AppState>();
    *state.backend.lock().unwrap() = Some(backend.1);
    *state.sidecar.lock().unwrap() = Some(sidecar.1);

    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState {
            backend: Mutex::new(None),
            sidecar: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![start_services])
        .setup(|app| {
            // 앱 시작 시 서비스 자동 시작
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // 서비스 시작 전 로딩 화면 표시 가능
                start_services(handle).await.expect("서비스 시작 실패");
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // 창 닫힐 때 프로세스 정리
            if let tauri::WindowEvent::Destroyed = event {
                let state = window.state::<AppState>();
                if let Some(mut child) = state.backend.lock().unwrap().take() {
                    child.kill().ok();
                }
                if let Some(mut child) = state.sidecar.lock().unwrap().take() {
                    child.kill().ok();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("Tauri 앱 실행 실패");
}
```

---

## Phase 5. 모델 초기 다운로드 UI

첫 실행 시 모델이 없으면 다운로드 화면을 표시합니다.

### 5-1. Frontend - 모델 다운로드 페이지

`frontend/src/pages/ModelSetupPage.tsx`:

```tsx
import { invoke } from '@tauri-apps/api/core'
import { useState, useEffect } from 'react'

export function ModelSetupPage() {
  const [progress, setProgress] = useState<Record<string, number>>({})

  const downloadModels = async () => {
    await invoke('download_models', {
      onProgress: (model: string, pct: number) => {
        setProgress(prev => ({ ...prev, [model]: pct }))
      }
    })
  }

  return (
    <div>
      <h1>모델 다운로드</h1>
      <p>첫 실행 시 AI 모델을 다운로드합니다. (~1.3GB)</p>
      {Object.entries(progress).map(([model, pct]) => (
        <div key={model}>
          <span>{model}</span>
          <progress value={pct} max={100} />
        </div>
      ))}
      <button onClick={downloadModels}>다운로드 시작</button>
    </div>
  )
}
```

### 5-2. 앱 시작 시 모델 존재 여부 확인

```tsx
// App.tsx
import { invoke } from '@tauri-apps/api/core'

function App() {
  const [modelsReady, setModelsReady] = useState(false)

  useEffect(() => {
    invoke<boolean>('check_models_exist').then(setModelsReady)
  }, [])

  if (!modelsReady) return <ModelSetupPage onComplete={() => setModelsReady(true)} />
  return <MainApp />
}
```

---

## Phase 6. Frontend API 엔드포인트 수정

현재 환경변수로 API URL을 관리하므로, Tauri 환경에서는 `localhost`로 고정합니다.

`frontend/src/api/client.ts` (또는 현재 ky 설정 위치):

```typescript
const isTauri = '__TAURI_INTERNALS__' in window

export const API_BASE_URL = isTauri
  ? 'http://127.0.0.1:3001'
  : import.meta.env.VITE_API_URL

export const SIDECAR_URL = isTauri
  ? 'http://127.0.0.1:8000'
  : import.meta.env.VITE_SIDECAR_URL
```

---

## Phase 7. 빌드 및 패키징

```bash
cd frontend

# 개발 모드 (서비스는 별도 실행 필요)
npm run tauri dev

# 프로덕션 빌드
npm run tauri build
# 결과물: src-tauri/target/release/bundle/macos/ddobakddobak.app
#         src-tauri/target/release/bundle/dmg/ddobakddobak_x.x.x_aarch64.dmg
```

---

## 예상 배포 크기

| 구성 요소 | 크기 |
|-----------|------|
| Tauri shell + Frontend | ~15MB |
| Rails binary (Ruby 포함) | ~80MB |
| Python sidecar (torch 포함, 모델 제외) | ~500MB |
| **앱 번들 합계** | **~600MB** |
| Qwen3-ASR 1.7B 모델 (외부) | ~1GB |
| PyAnnote 모델 (외부) | ~300MB |

---

## 작업 순서 요약

```
1. [ ] Phase 1: Tauri 프로젝트 초기화 (1-2일)
2. [ ] Phase 2: Rails 번들링 스크립트 작성 (2-3일)
3. [ ] Phase 5: 모델 다운로드 UI (1-2일)
4. [ ] Phase 3: PyInstaller sidecar 패키징 (2-3일)
5. [ ] Phase 4: Rust 오케스트레이션 코드 (2-3일)
6. [ ] Phase 6: Frontend API URL 처리 (0.5일)
7. [ ] Phase 7: 통합 빌드 및 테스트 (2-3일)
```

## 주의사항

- **코드 사이닝**: macOS 배포 시 Apple Developer 계정 필요 (notarization)
- **Gatekeeper**: 서명 없이 배포 시 사용자가 직접 허용해야 함
- **모델 업데이트**: 외부 모델 디렉토리이므로 앱 업데이트 없이 모델만 교체 가능
- **포트 충돌**: 3001, 8000 포트 사용 중 여부 확인 로직 필요
- **ActionCable**: Rails가 localhost에서 실행되므로 WebSocket도 `ws://127.0.0.1:3001/cable`로 변경
