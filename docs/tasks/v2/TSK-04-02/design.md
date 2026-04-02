# TSK-04-02: SetupPage 모드 분기 설계

> status: design-done
> updated: 2026-04-02

---

## 1. 변경 대상 파일

### 1.1 `frontend/src/components/SetupGate.tsx` (핵심 변경)

**현재 코드:**
```tsx
import { IS_TAURI } from '../config'

const needsSetup = IS_TAURI && !import.meta.env.DEV
```

**변경 후:**
```tsx
import { IS_TAURI, getMode } from '../config'

const isServerMode = getMode() === 'server'
const needsSetup = IS_TAURI && !import.meta.env.DEV && !isServerMode
```

**변경 이유:**
- 서버 모드에서는 환경 확인(ruby, uv, ffmpeg), 의존성 설치, 서비스 시작이 불필요
- `needsSetup`에 `!isServerMode` 조건을 추가하면 서버 모드에서 `needsSetup = false` -> `ready = true` -> children 즉시 렌더링
- 기존 로컬 모드 동작에 영향 없음

### 1.2 `frontend/src/pages/SetupPage.tsx` (변경 없음)

- SetupGate에서 서버 모드를 걸러주므로 SetupPage는 서버 모드에서 렌더링되지 않음
- 내부 로직(check_environment, install_dependencies, start_services 등) 변경 불필요
- SetupPage가 직접 호출될 경로가 없으므로 방어적 체크도 불필요

### 1.3 `frontend/src/App.tsx` (변경 없음)

- 기존 구조 유지: `SetupGate > AuthGuard > Routes`
- SetupGate 내부 분기만으로 충분

---

## 2. 주요 결정 사항

### 2.1 SetupGate에서 분기 (SetupPage 내부가 아닌)

- SetupPage 내부에서 모드를 체크하고 early return 하는 대신, SetupGate 레벨에서 분기
- 이유: SetupPage가 마운트되면 useEffect로 `check_environment` invoke가 즉시 실행됨. 서버 모드에서 Tauri invoke 호출 자체를 방지하려면 SetupPage 렌더링을 막아야 함
- SetupGate는 이미 "SetupPage를 보여줄지 말지" 결정하는 게이트 역할이므로, 여기서 모드를 판단하는 것이 책임 분리에 적합

### 2.2 getMode()는 동기 호출 (localStorage)

- `getMode()`는 localStorage에서 동기적으로 값을 읽으므로, 컴포넌트 렌더링 시점에 즉시 사용 가능
- 비동기 로딩이나 상태 관리가 필요 없음
- TSK-04-01에서 이미 구현 완료된 함수를 재활용

### 2.3 SetupPage 방어적 체크 불필요

- SetupPage는 SetupGate 내부에서만 렌더링됨 (export는 되지만 App.tsx에서 직접 사용하지 않음)
- SetupGate가 유일한 진입점이므로 방어 코드 중복은 불필요

---

## 3. 앱 시작 플로우 (변경 후)

```
앱 실행
  ├─ SetupGate 마운트
  │    ├─ getMode() 호출
  │    ├─ mode === 'server'
  │    │    └─ needsSetup = false → ready = true → children 즉시 렌더링
  │    └─ mode === 'local'
  │         ├─ IS_TAURI && !DEV → needsSetup = true
  │         └─ SetupPage 표시 → 환경 확인 → 서비스 시작 → onReady → children 렌더링
  │
  ├─ AuthGuard 마운트
  │    ├─ mode === 'server' → JWT 검증 → 로그인 흐름
  │    └─ mode === 'local' → 통과
  │
  └─ Routes 렌더링
```

---

## 4. 테스트 전략

### 4.1 수동 테스트 (Tauri dev 모드)

| 시나리오 | 조건 | 기대 결과 |
|---------|------|----------|
| 서버 모드 앱 시작 | localStorage: mode=server | SetupPage 표시 없이 즉시 메인 화면 (또는 로그인 화면) |
| 로컬 모드 앱 시작 | localStorage: mode=local (또는 미설정) | SetupPage 표시, 환경 확인 → 서비스 시작 흐름 |
| 모드 미설정 상태 | localStorage에 mode 키 없음 | getMode() 기본값 'local' → 기존 SetupPage 흐름 |
| 서버 모드 + Tauri 프로덕션 | mode=server, IS_TAURI=true, DEV=false | SetupPage 건너뛰기 |
| 웹 개발 모드 | IS_TAURI=false | needsSetup=false (기존 동작 유지) |

### 4.2 단위 테스트 (선택적)

- SetupGate 컴포넌트 테스트: `getMode()` mock으로 'server' 반환 시 children이 즉시 렌더링되는지 확인
- `getMode()` 자체는 TSK-04-01에서 이미 테스트됨

### 4.3 회귀 테스트

- 로컬 모드에서 기존 SetupPage 흐름이 깨지지 않는지 확인
- 특히 `check_environment`, `start_services` invoke가 정상 호출되는지 확인

---

## 5. 영향 범위

- 변경 파일: 1개 (`SetupGate.tsx`)
- 변경 라인: 2줄 (import 수정 + 조건 추가)
- 위험도: 낮음 (기존 조건에 AND 조건 하나 추가)
- 롤백: import와 조건 1줄 제거로 즉시 롤백 가능
