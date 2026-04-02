# TSK-02-02 리팩토링 보고서

> date: 2026-04-02

## 변경 사항

### 1. URL 정규화 로직 중복 제거
- `serverUrl.replace(/\/+$/, '')` 가 `checkHealth`와 `handleComplete` 두 곳에서 중복 사용됨
- `normalizeUrl()` 헬퍼 함수로 추출하여 단일화

### 2. localStorage 모드 값 타입 안전성 개선
- 기존: `localStorage.getItem('mode') as Mode | null` -- unsafe cast (잘못된 문자열이 저장된 경우 런타임 오류 가능)
- 변경: `isValidMode()` 타입 가드 함수 도입, `VALID_MODES` Set으로 유효한 값만 허용

### 3. 접근성(a11y) 개선
- 모드 선택 버튼에 `aria-pressed` 속성 추가 (현재 선택 상태를 스크린리더에 전달)
- 헬스체크 결과 영역을 `role="status"` + `aria-live="polite"` 래퍼로 감싸 상태 변경 시 스크린리더에 자동 알림

### 4. 테스트 파일 미사용 import 제거
- `userEvent` import가 선언만 되고 사용되지 않아 제거

## 변경하지 않은 항목 및 사유

| 항목 | 사유 |
|------|------|
| 컴포넌트 분리 (모드 카드, URL 입력부 등) | 현재 200줄 이하로 단일 컴포넌트 유지가 가독성에 유리 |
| 에러 핸들링 구조 | `try/catch` 내 분기가 명확하고 에러 타입별 처리가 적절함 |
| CSS 클래스 추출 | Tailwind 유틸리티 직접 사용이 관례에 부합하며 가독성 저하 없음 |
| 함수/변수 네이밍 | `handleUrlChange`, `checkHealth`, `handleComplete` 등 이미 의미가 명확함 |
| 상태 관리 구조 | 4개의 단순 state로 충분, Zustand/useReducer 도입은 과도함 |

## 테스트 결과

```
 Test Files  1 passed (1)
      Tests  22 passed (22)
   Duration  655ms
```

모든 22개 테스트 통과, 리그레션 없음.
