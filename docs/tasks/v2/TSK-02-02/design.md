# TSK-02-02: ServerSetup.tsx 설계

> 앱 첫 실행 시 로컬/서버 모드 선택 및 서버 URL 입력 컴포넌트

**파일 경로:** `frontend/src/components/auth/ServerSetup.tsx`
**상태:** 설계 완료
**참조:** PRD 3.4, TRD 2.3, wbs.md TSK-02-02

---

## 1. 개요

Tauri 앱 최초 실행 시(또는 설정 미완료 시) 사용자에게 실행 모드를 선택하게 한다.

- **로컬 실행**: 기존 V1과 동일하게 localhost:13323에서 Rails + Sidecar를 직접 실행
- **서버 연결**: 원격 서버 URL을 입력하고 헬스체크로 연결을 확인

선택 결과는 localStorage에 저장하며, 이후 config.ts(TSK-04-01)에서 읽어 API/WS URL을 분기한다.

---

## 2. localStorage 스키마

| Key | Type | 기본값 | 설명 |
|-----|------|--------|------|
| `mode` | `'local' \| 'server'` | (없음) | 실행 모드. 미설정 시 ServerSetup 표시 |
| `server_url` | `string` | (없음) | 서버 모드 시 서버 URL (예: `https://api.example.com`) |

- Zustand store를 만들지 않는다. `localStorage.getItem` / `localStorage.setItem` 직접 사용.
- `mode` 키가 localStorage에 없으면 아직 설정 전 상태로 판단한다.

---

## 3. 컴포넌트 구조

```
frontend/src/components/auth/ServerSetup.tsx   (이 설계의 대상)
```

### 3.1 Props

```typescript
interface ServerSetupProps {
  onComplete: () => void  // 설정 완료 시 호출 (부모가 다음 단계로 전환)
}
```

### 3.2 내부 상태

```typescript
type Mode = 'local' | 'server'

// 선택된 모드 (기본: 미선택)
const [mode, setMode] = useState<Mode | null>(null)

// 서버 URL 입력값
const [serverUrl, setServerUrl] = useState('')

// 헬스체크 상태
const [healthStatus, setHealthStatus] = useState<'idle' | 'checking' | 'success' | 'error'>('idle')

// 헬스체크 에러 메시지
const [healthError, setHealthError] = useState<string | null>(null)
```

### 3.3 초기화

컴포넌트 마운트 시 localStorage에서 기존 설정을 복원한다 (설정 변경 시나리오 대응).

```typescript
useEffect(() => {
  const savedMode = localStorage.getItem('mode') as Mode | null
  const savedUrl = localStorage.getItem('server_url')
  if (savedMode) setMode(savedMode)
  if (savedUrl) setServerUrl(savedUrl)
}, [])
```

---

## 4. UI 구성

전체 레이아웃은 SetupPage.tsx와 동일한 패턴을 따른다: 화면 중앙 배치, `max-w-lg` 카드.

```
┌─────────────────────────────────────────┐
│              또박또박                      │
│     AI 회의록 - 실행 모드를 선택하세요     │
│                                           │
│  ┌─────────────────┐ ┌─────────────────┐  │
│  │  🖥  로컬 실행   │ │  🌐  서버 연결   │  │
│  │                 │ │                 │  │
│  │  이 컴퓨터에서   │ │  원격 서버에     │  │
│  │  직접 실행       │ │  연결하여 사용   │  │
│  └─────────────────┘ └─────────────────┘  │
│                                           │
│  ── 서버 모드 선택 시 아래 영역 표시 ──     │
│                                           │
│  서버 URL                                 │
│  ┌──────────────────────┐ ┌──────────┐   │
│  │ https://              │ │ 연결 확인 │   │
│  └──────────────────────┘ └──────────┘   │
│                                           │
│  ✅ 서버 연결 성공 (또는 ❌ 에러 메시지)    │
│                                           │
│          ┌─────────────────┐              │
│          │      시작하기     │              │
│          └─────────────────┘              │
└─────────────────────────────────────────┘
```

### 4.1 모드 선택 카드

두 개의 선택 카드를 가로로 배치한다. 선택된 카드는 `ring-2 ring-blue-500` 테두리로 강조.

| 카드 | 아이콘 (lucide-react) | 제목 | 설명 |
|------|----------------------|------|------|
| 로컬 실행 | `Monitor` | 로컬 실행 | 이 컴퓨터에서 직접 실행합니다 |
| 서버 연결 | `Globe` | 서버 연결 | 원격 서버에 연결하여 사용합니다 |

### 4.2 서버 URL 입력 (서버 모드 시)

`mode === 'server'`일 때만 표시된다. 애니메이션 없이 즉시 표시.

- **라벨**: "서버 URL"
- **input**: `type="url"`, `placeholder="https://api.example.com"`
- **연결 확인 버튼**: input 오른쪽에 배치
- URL 미입력 시 연결 확인 버튼 비활성화

### 4.3 헬스체크 결과 영역

| 상태 | 표시 |
|------|------|
| `idle` | 표시 안 함 |
| `checking` | `Loader2` 스피너 + "서버에 연결 중..." |
| `success` | `CheckCircle` (녹색) + "서버 연결 성공" |
| `error` | `XCircle` (빨간색) + 에러 메시지 |

### 4.4 시작하기 버튼

- 로컬 모드 선택 시: 모드 선택만으로 활성화
- 서버 모드 선택 시: 헬스체크 `success` 상태에서만 활성화
- 비활성화 시 `opacity-50 cursor-not-allowed`

---

## 5. 헬스체크 로직

### 5.1 엔드포인트

```
GET ${serverUrl}/api/v1/health
```

Rails API의 기존 헬스체크 엔드포인트를 사용한다.

### 5.2 구현

```typescript
const checkHealth = async () => {
  setHealthStatus('checking')
  setHealthError(null)

  try {
    // URL 정규화: 후행 슬래시 제거
    const normalizedUrl = serverUrl.replace(/\/+$/, '')

    const response = await fetch(`${normalizedUrl}/api/v1/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),  // 5초 타임아웃
    })

    if (response.ok) {
      setHealthStatus('success')
    } else {
      setHealthStatus('error')
      setHealthError(`서버 응답 오류 (HTTP ${response.status})`)
    }
  } catch (err) {
    setHealthStatus('error')
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      setHealthError('서버 응답 시간이 초과되었습니다 (5초)')
    } else {
      setHealthError('서버에 연결할 수 없습니다. URL을 확인해주세요.')
    }
  }
}
```

### 5.3 주의사항

- `fetch`를 직접 사용한다 (ky 인스턴스는 아직 서버 URL이 미확정 상태이므로).
- CORS: 서버에서 `CORS_ORIGIN` 환경변수로 클라이언트 origin을 허용해야 한다 (TSK-01-03에서 구현 완료).
- Tauri 환경에서는 CORS 제약이 없으므로 문제없이 동작한다.

---

## 6. 저장 및 완료 처리

```typescript
const handleComplete = () => {
  if (mode === 'local') {
    localStorage.setItem('mode', 'local')
    localStorage.removeItem('server_url')
  } else if (mode === 'server') {
    const normalizedUrl = serverUrl.replace(/\/+$/, '')
    localStorage.setItem('mode', 'server')
    localStorage.setItem('server_url', normalizedUrl)
  }
  onComplete()
}
```

`onComplete()` 호출 후 부모 컴포넌트가 다음 단계로 전환한다:
- 로컬 모드: SetupPage (기존 V1 환경 확인/서비스 시작 흐름)
- 서버 모드: 로그인 화면 (TSK-02-03에서 구현)

---

## 7. 스타일링

### 7.1 전체 레이아웃

SetupPage.tsx와 동일한 패턴:

```
min-h-screen bg-gradient-to-br from-slate-50 to-slate-100
  -> max-w-lg bg-white rounded-2xl shadow-lg p-8
```

### 7.2 사용 라이브러리

| 항목 | 라이브러리 |
|------|-----------|
| 스타일링 | Tailwind CSS (프로젝트 기존 설정) |
| 아이콘 | lucide-react (`Monitor`, `Globe`, `CheckCircle`, `XCircle`, `Loader2`) |
| 클래스 병합 | tailwind-merge (`twMerge`) - 선택적 사용 |

### 7.3 반응형

모바일 고려 불필요 (Tauri 데스크톱 앱). 최소 너비 400px 이상 전제.

---

## 8. 엣지 케이스

| 케이스 | 처리 |
|--------|------|
| URL에 후행 슬래시 포함 (`https://a.com/`) | `replace(/\/+$/, '')`로 제거 후 저장 |
| URL에 프로토콜 미포함 (`a.com`) | input `type="url"` 브라우저 검증에 의존. 추가로 `https://` 미포함 시 안내 메시지 표시 |
| 헬스체크 중 URL 변경 | 상태를 `idle`로 리셋 |
| 네트워크 끊김 | catch에서 일반 에러 메시지 표시 |
| 이전 설정 존재 (재설정) | 마운트 시 localStorage에서 복원 |

---

## 9. 파일 변경 요약

| 파일 | 변경 |
|------|------|
| `frontend/src/components/auth/ServerSetup.tsx` | **신규 생성** |

- config.ts, App.tsx 등 기존 파일은 수정하지 않는다.
- App.tsx에 라우트를 추가하지 않는다 (TSK-02-03, TSK-04-02에서 통합).
- Zustand store를 만들지 않는다.

---

## 10. 의존성 및 후속 작업

| 방향 | 태스크 | 관계 |
|------|--------|------|
| 선행 | 없음 | ServerSetup은 독립적으로 구현 가능 |
| 후행 | TSK-04-01 (config.ts 모드 분기) | localStorage의 `mode`, `server_url`을 읽어 API_BASE_URL, WS_URL 분기 |
| 후행 | TSK-02-03 (로그인 흐름 구현) | 서버 모드일 때 로그인 화면 표시 |
| 후행 | TSK-04-02 (SetupPage 모드 분기) | 앱 시작 시 모드에 따라 SetupPage 또는 ServerSetup 표시 |
