# TSK-03-03 리팩토링 리포트

## 대상 파일
- `frontend/src/api/userLlmSettings.ts`
- `frontend/src/components/settings/UserLlmSettings.tsx`
- `frontend/src/components/settings/UserLlmSettings.test.tsx`
- `frontend/src/components/settings/SettingsContent.tsx` (변경 없음)

## 수행한 개선 사항

### 1. 타입 안전성 (UserLlmSettings.tsx)
- `PROVIDER_OPTIONS`에 명시적 `ProviderOption` 인터페이스 정의 및 적용. 기존 `as const`와 `[] as string[]` 혼용으로 타입 추론이 불안정했던 부분 해소.
- `handleProviderSelect` 내 `PROVIDER_OPTIONS.find(...)!` 비-null 단언(`!`)을 제거하고 optional chaining(`?.`)으로 교체.

### 2. 불필요한 코드 제거 (UserLlmSettings.tsx)
- `setBaseUrl(id === 'openai_custom' ? '' : '')` 양쪽 분기가 동일한 값(`''`)이었으므로 `setBaseUrl('')`로 단순화.
- `handleSave`에서 `api_key: apiKey || ''` (빈 문자열 전송)을 조건부 spread(`...(apiKey ? { api_key: apiKey } : {})`)로 변경. 빈 문자열이 서버에 불필요하게 전송되는 것을 방지.

### 3. 불필요한 리렌더링 방지 (UserLlmSettings.tsx)
- `initFormFromSettings`를 `useCallback`으로 감싸고 `useEffect` 의존성 배열에 포함. React strict mode 및 린트 경고 방지.

### 4. 접근성(a11y) 개선 (UserLlmSettings.tsx)
- Provider 선택 영역을 `<fieldset>` + `<legend>`로 감싸고, 버튼 그룹에 `role="radiogroup"`, 각 버튼에 `role="radio"` + `aria-checked` 추가.
- 모든 `<label>`에 `htmlFor` 속성 추가 및 대응 input/select에 `id` 부여 (`user-llm-api-key`, `user-llm-base-url`, `user-llm-model`).
- 모든 `<button>`에 `type="button"` 명시 (폼 내 의도치 않은 submit 방지).
- 로딩/성공/에러 메시지에 `role="status"`, `role="alert"`, `aria-live="polite"` 추가.

### 5. 변경 없음으로 판단한 파일
- **`userLlmSettings.ts`** (API): 타입 정의와 API 함수 구조가 간결하고 패턴이 일관적이어서 개선 필요 없음.
- **`UserLlmSettings.test.tsx`** (테스트): 10개 테스트 케이스가 주요 시나리오를 적절히 커버하며, mock 구조도 깔끔. 개선 필요 없음.
- **`SettingsContent.tsx`**: `<UserLlmSettings />` 단순 배치만 담당하며 변경 불필요.

## 테스트 결과
- 리팩토링 후 10/10 테스트 통과 확인.
