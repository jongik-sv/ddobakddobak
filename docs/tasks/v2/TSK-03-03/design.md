# TSK-03-03: 사용자 LLM 설정 UI - 설계 문서

> 설정 모달에 "내 LLM 설정" 섹션을 추가하여, 사용자별 LLM 설정(Provider, API 키, 모델, Base URL)을 관리하고 연결 테스트를 수행한다.

**작성일:** 2026-04-02
**상태:** Design
**참조:** PRD 3.2.2 / TRD 2.2 / TSK-03-02

---

## 1. 현재 상태

### 1.1 기존 LLM 설정 UI (서버 전체 공유)

`SettingsContent.tsx`에 이미 "AI 요약 모델" 섹션이 존재한다:

| 항목 | 설명 |
|------|------|
| `SERVICE_PRESETS` | 8개 프리셋 (Claude CLI, Gemini CLI, Codex CLI, Anthropic, Z.AI, OpenAI, Ollama, 직접 입력) |
| `presetCache` | 프리셋별 폼 상태 캐시 |
| `handleLlmTest` | `POST /api/v1/settings/llm/test` 호출 |
| `handleLlmSave` | `PUT /api/v1/settings/llm` 호출 |

이 기존 UI는 **서버 전체 공유 설정** (`settings.yaml` 프리셋 관리)을 다루며, 사용자 개인 LLM 설정과는 별도 API를 사용한다.

### 1.2 TSK-03-02에서 구현된 사용자별 LLM API

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/v1/user/llm_settings` | 내 LLM 설정 조회 |
| PUT | `/api/v1/user/llm_settings` | 내 LLM 설정 변경 |
| POST | `/api/v1/user/llm_settings/test` | 내 LLM 연결 테스트 |

**응답 형태:**

```json
{
  "llm_settings": {
    "provider": "anthropic",
    "api_key_masked": "sk-a****5678",
    "model": "claude-sonnet-4-6",
    "base_url": null,
    "configured": true
  },
  "server_default": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-6",
    "has_key": true
  }
}
```

**사용자별 API의 특징:**
- `provider`는 `"anthropic"` | `"openai"` 2가지만 허용 (CLI 프로바이더 없음)
- `api_key` 빈 문자열 전송 시 기존 키 유지
- `provider` 빈값/null 전송 시 전체 초기화 (서버 기본값 폴백)
- `test` 시 `api_key` 미전송이면 저장된 키 사용

### 1.3 기존 설정 모달 구조

```
SettingsModal.tsx
├── 헤더 (제목 + 닫기 버튼)
└── 스크롤 가능 본문
    └── SettingsContent.tsx
        ├── STT 모델
        ├── 회의 언어
        ├── AI 요약 모델       ← 서버 전체 공유 설정
        ├── AI 회의록 적용 주기
        ├── 회의록 양식 관리
        ├── 음성 청킹 설정
        ├── HuggingFace
        └── 화자 분리 설정
```

### 1.4 설계 방향

기존 "AI 요약 모델" 섹션 **위에** "내 LLM 설정" 섹션을 새로 추가한다.

**이유:**
- 기존 "AI 요약 모델"은 서버 관리자가 `settings.yaml` 프리셋을 관리하는 용도 (로컬 모드 전용)
- "내 LLM 설정"은 사용자 개인의 LLM을 설정하는 용도 (서버 모드에서 핵심)
- 둘은 서로 다른 API를 호출하며, 역할이 다르므로 별도 섹션으로 분리
- 서버 모드에서는 "AI 요약 모델" (서버 공유) 대신 "내 LLM 설정" (개인)만 표시할 수 있음 (향후 고려)

---

## 2. 컴포넌트 구조

### 2.1 신규 파일

```
frontend/src/
├── api/
│   └── userLlmSettings.ts              # 사용자별 LLM API 클라이언트 (신규)
├── components/settings/
│   └── UserLlmSettings.tsx             # 내 LLM 설정 섹션 컴포넌트 (신규)
│   └── UserLlmSettings.test.tsx        # Vitest 테스트 (신규)
│   └── SettingsContent.tsx             # 수정: UserLlmSettings 임포트 추가
```

### 2.2 컴포넌트 계층

```
SettingsContent.tsx
├── STT 모델
├── 회의 언어
├── ▶ UserLlmSettings.tsx   ← 신규 ("내 LLM 설정" 섹션)
├── AI 요약 모델 (기존)
├── AI 회의록 적용 주기
├── ...
```

---

## 3. API 클라이언트 설계

### 3.1 파일: `frontend/src/api/userLlmSettings.ts`

```typescript
import apiClient from './client'

// ── 타입 정의 ────────────────────────────

export interface UserLlmSettingsResponse {
  llm_settings: {
    provider: string | null
    api_key_masked: string | null
    model: string | null
    base_url: string | null
    configured: boolean
  }
  server_default: {
    provider: string | null
    model: string | null
    has_key: boolean
  }
}

export interface UserLlmSettingsUpdateParams {
  llm_settings: {
    provider: string
    api_key?: string       // 빈 문자열 = 기존 유지, null = 삭제
    model?: string
    base_url?: string | null
  }
}

export interface UserLlmTestParams {
  provider: string
  model: string
  api_key?: string         // 미전송 시 서버 저장된 키 사용
  base_url?: string
}

export interface UserLlmTestResult {
  success: boolean
  error?: string
  message?: string
  response_time_ms?: number
}

// ── API 함수 ────────────────────────────

export async function getUserLlmSettings(): Promise<UserLlmSettingsResponse> {
  return apiClient.get('user/llm_settings').json()
}

export async function updateUserLlmSettings(
  params: UserLlmSettingsUpdateParams
): Promise<UserLlmSettingsResponse> {
  return apiClient.put('user/llm_settings', { json: params }).json()
}

export async function testUserLlmConnection(
  params: UserLlmTestParams
): Promise<UserLlmTestResult> {
  return apiClient.post('user/llm_settings/test', { json: params }).json()
}
```

---

## 4. UserLlmSettings 컴포넌트 설계

### 4.1 파일: `frontend/src/components/settings/UserLlmSettings.tsx`

### 4.2 상태 관리

컴포넌트 로컬 state로 관리한다 (Zustand 스토어 불필요 --- 설정 모달 내에서만 사용되며, 열 때마다 서버에서 최신 값을 가져옴).

```typescript
// 데이터 상태
const [settings, setSettings] = useState<UserLlmSettingsResponse | null>(null)
const [loading, setLoading] = useState(true)

// 폼 상태
const [provider, setProvider] = useState<string>('')      // 'anthropic' | 'openai' | ''
const [apiKey, setApiKey] = useState('')                   // 새로 입력한 키 (마스킹 아님)
const [model, setModel] = useState('')
const [baseUrl, setBaseUrl] = useState('')

// 액션 상태
const [saving, setSaving] = useState(false)
const [testing, setTesting] = useState(false)
const [testResult, setTestResult] = useState<UserLlmTestResult | null>(null)
const [error, setError] = useState<string | null>(null)
const [success, setSuccess] = useState<string | null>(null)
```

### 4.3 Provider 옵션

사용자별 API가 허용하는 provider는 2가지이며, 커스텀 엔드포인트(Ollama 등)는 `openai` provider + `base_url`로 처리한다:

```typescript
const PROVIDER_OPTIONS = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Claude 시리즈',
    suggestedModels: ['claude-sonnet-4-6', 'claude-haiku-4-5'],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT 시리즈',
    suggestedModels: ['gpt-4o', 'gpt-4o-mini'],
  },
  {
    id: 'openai_custom',
    name: '커스텀',
    description: 'Ollama, vLLM 등 OpenAI 호환',
    suggestedModels: [],
    isCustom: true,       // base_url 입력 필수
    actualProvider: 'openai',  // API 전송 시 'openai'
  },
] as const
```

**설계 근거:**
- 백엔드 `VALID_PROVIDERS`는 `['anthropic', 'openai']`만 허용
- "커스텀"은 UI 레벨 구분이며, API 전송 시 `provider: 'openai'` + `base_url` 조합으로 처리
- 기존 서버 공유 설정의 CLI 프리셋(Claude CLI, Gemini CLI 등)은 사용자별 설정에서 지원하지 않음 (서버에서 직접 CLI를 호출하는 방식이므로 개인 설정과 무관)

### 4.4 UI 레이아웃

```
┌─ 내 LLM 설정 ───────────────────────────────────────────────┐
│                                                               │
│  [미설정 배너]  서버 기본값 사용 중 (Anthropic / claude-...)   │
│                 개인 LLM을 설정하면 회의 요약에 사용됩니다.    │
│                                                               │
│  Provider 선택                                                │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐                │
│  │ Anthropic  │ │  OpenAI    │ │  커스텀    │                │
│  │ Claude     │ │  GPT       │ │  Ollama 등 │                │
│  └────────────┘ └────────────┘ └────────────┘                │
│                                                               │
│  API Key                                                      │
│  ┌──────────────────────────────────────────┐                │
│  │ ●●●●●●●●●●●●●●●●●●                      │                │
│  └──────────────────────────────────────────┘                │
│  현재: sk-a****5678                                           │
│                                                               │
│  Base URL (커스텀 선택 시만 표시)                              │
│  ┌──────────────────────────────────────────┐                │
│  │ http://localhost:11434/v1                │                │
│  └──────────────────────────────────────────┘                │
│                                                               │
│  모델명                                  [목록에서 선택/직접 입력]│
│  ┌──────────────────────────────────────────┐                │
│  │ claude-sonnet-4-6        ▼               │                │
│  └──────────────────────────────────────────┘                │
│                                                               │
│  [연결 테스트]  [저장]  [설정 초기화]                          │
│                                                               │
│  ✓ 연결 성공 (1234ms)                                        │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

### 4.5 주요 인터랙션 흐름

#### 4.5.1 초기 로드

```
마운트 → getUserLlmSettings() → 응답으로 폼 초기화
  - settings.llm_settings.provider → provider state
  - settings.llm_settings.model → model state
  - settings.llm_settings.base_url → baseUrl state
  - apiKey는 빈 문자열 (마스킹된 값은 settings.llm_settings.api_key_masked에서 표시)
```

#### 4.5.2 Provider 선택

```
Provider 카드 클릭 → setProvider(id)
  - 'openai_custom' 선택 시: actualProvider='openai', base_url 입력 필드 표시
  - provider 변경 시: model을 해당 provider의 suggestedModels[0]으로 초기화
  - testResult 초기화
```

#### 4.5.3 저장

```
저장 클릭 → updateUserLlmSettings({
  llm_settings: {
    provider: actualProvider,  // 'anthropic' 또는 'openai'
    api_key: apiKey || '',     // 빈 문자열이면 서버에서 기존 키 유지
    model: model,
    base_url: baseUrl || null
  }
}) → 성공 시 settings 갱신 + 성공 메시지
```

#### 4.5.4 연결 테스트

```
테스트 클릭 → testUserLlmConnection({
  provider: actualProvider,
  model: model,
  api_key: apiKey || undefined,  // 미전송 시 서버 저장된 키 사용
  base_url: baseUrl || undefined
}) → testResult 상태 업데이트
```

#### 4.5.5 설정 초기화

```
초기화 클릭 → updateUserLlmSettings({
  llm_settings: { provider: '' }
}) → 서버에서 전체 초기화 → 폼 리셋 → "서버 기본값 사용 중" 배너 표시
```

### 4.6 미설정 상태 표현

`settings.llm_settings.configured === false`일 때:

```html
<div class="border border-amber-200 bg-amber-50 rounded-md p-4">
  <p class="font-medium">서버 기본값 사용 중</p>
  <p class="text-sm text-muted">
    서버 기본 LLM ({server_default.provider} / {server_default.model})을 사용합니다.
    개인 LLM을 설정하면 회의 요약에 해당 LLM이 사용됩니다.
  </p>
</div>
```

`server_default.has_key === false`일 때 추가 경고:

```html
<p class="text-sm text-red-600">
  서버에 기본 LLM이 설정되어 있지 않습니다. 개인 LLM을 설정해야 요약 기능을 사용할 수 있습니다.
</p>
```

### 4.7 연결 테스트 결과 표현

| 결과 | UI |
|------|-----|
| 성공 | 초록색 텍스트: "연결 성공" + 응답 시간(ms) |
| 실패 | 빨간색 텍스트: "연결 실패: {error}" |
| 테스트 중 | 비활성화 버튼 + "테스트 중..." 텍스트 |
| Sidecar 불가 | 노란색 텍스트: "Sidecar 서비스에 연결할 수 없습니다" |

---

## 5. SettingsContent.tsx 수정

### 5.1 변경 내용

"회의 언어" 섹션 바로 아래, "AI 요약 모델" 섹션 바로 위에 `<UserLlmSettings />` 삽입:

```tsx
import UserLlmSettings from './UserLlmSettings'

// ...

return (
  <div className="max-w-2xl space-y-6">
    {/* STT 모델 설정 */}
    {/* ... */}

    {/* 회의 언어 설정 */}
    {/* ... */}

    {/* ▶ 내 LLM 설정 (신규) */}
    <UserLlmSettings />

    {/* AI (LLM) 설정 (기존 서버 공유) */}
    {/* ... */}
  </div>
)
```

---

## 6. 테스트 전략

### 6.1 파일: `frontend/src/components/settings/UserLlmSettings.test.tsx`

Vitest + React Testing Library로 작성한다.

### 6.2 테스트 케이스

#### 6.2.1 로딩 상태

```typescript
it('로딩 중일 때 로딩 텍스트를 표시한다', async () => {
  // getUserLlmSettings가 pending 상태일 때
  render(<UserLlmSettings />)
  expect(screen.getByText('불러오는 중...')).toBeInTheDocument()
})
```

#### 6.2.2 미설정 상태

```typescript
it('LLM 미설정 시 "서버 기본값 사용 중" 배너를 표시한다', async () => {
  // getUserLlmSettings → configured: false 반환
  render(<UserLlmSettings />)
  await waitFor(() => {
    expect(screen.getByText(/서버 기본값 사용 중/)).toBeInTheDocument()
  })
})
```

#### 6.2.3 설정된 상태

```typescript
it('LLM 설정 시 현재 provider와 model을 표시한다', async () => {
  // getUserLlmSettings → configured: true, provider: 'anthropic' 반환
  render(<UserLlmSettings />)
  await waitFor(() => {
    expect(screen.getByText('Anthropic')).toBeInTheDocument()
  })
})
```

#### 6.2.4 Provider 선택

```typescript
it('Provider 카드를 클릭하면 해당 provider가 선택된다', async () => {
  render(<UserLlmSettings />)
  await waitFor(() => screen.getByText('Anthropic'))

  fireEvent.click(screen.getByText('OpenAI'))
  // OpenAI 카드가 선택 상태(border-blue)인지 확인
})
```

#### 6.2.5 저장

```typescript
it('저장 버튼 클릭 시 API를 호출하고 성공 메시지를 표시한다', async () => {
  // updateUserLlmSettings 모킹
  render(<UserLlmSettings />)
  await waitFor(() => screen.getByText('Anthropic'))

  fireEvent.click(screen.getByText('저장'))
  await waitFor(() => {
    expect(screen.getByText(/저장되었습니다/)).toBeInTheDocument()
  })
})
```

#### 6.2.6 연결 테스트 성공

```typescript
it('연결 테스트 성공 시 초록색 메시지를 표시한다', async () => {
  // testUserLlmConnection → { success: true, response_time_ms: 500 } 반환
  render(<UserLlmSettings />)
  await waitFor(() => screen.getByText('Anthropic'))

  fireEvent.click(screen.getByText('연결 테스트'))
  await waitFor(() => {
    expect(screen.getByText(/연결 성공/)).toBeInTheDocument()
  })
})
```

#### 6.2.7 연결 테스트 실패

```typescript
it('연결 테스트 실패 시 빨간색 에러 메시지를 표시한다', async () => {
  // testUserLlmConnection → { success: false, error: 'Invalid API key' } 반환
  render(<UserLlmSettings />)
  await waitFor(() => screen.getByText('Anthropic'))

  fireEvent.click(screen.getByText('연결 테스트'))
  await waitFor(() => {
    expect(screen.getByText(/연결 실패/)).toBeInTheDocument()
  })
})
```

#### 6.2.8 설정 초기화

```typescript
it('설정 초기화 시 폼을 리셋하고 "서버 기본값 사용 중"을 표시한다', async () => {
  // configured: true → 초기화 → configured: false
  render(<UserLlmSettings />)
  await waitFor(() => screen.getByText('Anthropic'))

  fireEvent.click(screen.getByText('설정 초기화'))
  await waitFor(() => {
    expect(screen.getByText(/서버 기본값 사용 중/)).toBeInTheDocument()
  })
})
```

#### 6.2.9 API 키 마스킹 표시

```typescript
it('현재 저장된 API 키를 마스킹하여 표시한다', async () => {
  // getUserLlmSettings → api_key_masked: 'sk-a****5678' 반환
  render(<UserLlmSettings />)
  await waitFor(() => {
    expect(screen.getByText(/sk-a\*+5678/)).toBeInTheDocument()
  })
})
```

#### 6.2.10 API 에러 처리

```typescript
it('API 에러 시 에러 메시지를 표시한다', async () => {
  // getUserLlmSettings 실패
  render(<UserLlmSettings />)
  await waitFor(() => {
    expect(screen.getByText(/불러오지 못했습니다/)).toBeInTheDocument()
  })
})
```

### 6.3 모킹 전략

API 모듈을 모킹하여 네트워크 요청 없이 테스트한다:

```typescript
vi.mock('../../api/userLlmSettings', () => ({
  getUserLlmSettings: vi.fn(),
  updateUserLlmSettings: vi.fn(),
  testUserLlmConnection: vi.fn(),
}))
```

---

## 7. 변경 파일 목록

| 파일 | 변경 내용 | 신규/수정 |
|------|----------|----------|
| `frontend/src/api/userLlmSettings.ts` | 사용자별 LLM API 클라이언트 | **신규** |
| `frontend/src/components/settings/UserLlmSettings.tsx` | 내 LLM 설정 섹션 컴포넌트 | **신규** |
| `frontend/src/components/settings/UserLlmSettings.test.tsx` | 컴포넌트 테스트 | **신규** |
| `frontend/src/components/settings/SettingsContent.tsx` | UserLlmSettings 임포트 및 렌더링 추가 | 수정 |

---

## 8. 기존 코드와의 관계

### 8.1 기존 "AI 요약 모델" 섹션과의 차이

| 항목 | 기존 (AI 요약 모델) | 신규 (내 LLM 설정) |
|------|---------------------|---------------------|
| 용도 | 서버 전체 공유 LLM 프리셋 관리 | 개인 LLM 설정 |
| API | `/api/v1/settings/llm` | `/api/v1/user/llm_settings` |
| Provider | 8개 (CLI 포함) | 3개 (Anthropic, OpenAI, 커스텀) |
| 토큰 제한 설정 | max_input_tokens, max_output_tokens | 없음 (서버에서 자동 처리) |
| 설정 초기화 | 없음 | 있음 (서버 기본값 폴백) |
| server_default 표시 | 없음 | 있음 |

### 8.2 향후 고려사항 (이 태스크 범위 밖)

| 항목 | 설명 |
|------|------|
| 서버 모드 시 기존 "AI 요약 모델" 숨김 | 서버 모드에서는 개인 설정만 유의미하므로, 기존 서버 공유 설정은 관리자 전용으로 분리 가능 |
| 요약 생성 시 개인 LLM 사용 확인 UI | 요약 결과에 "사용된 LLM: Claude Sonnet" 등 표시 |
| Provider별 모델 목록 API | 현재는 하드코딩된 suggestedModels 사용, 향후 동적 목록 제공 가능 |

---

## 9. 체크리스트

- [ ] `frontend/src/api/userLlmSettings.ts` 작성
- [ ] `frontend/src/components/settings/UserLlmSettings.tsx` 작성
- [ ] `frontend/src/components/settings/SettingsContent.tsx`에서 UserLlmSettings 임포트 및 렌더링 추가
- [ ] `frontend/src/components/settings/UserLlmSettings.test.tsx` 작성
- [ ] Vitest 테스트 실행 및 전체 통과 확인
