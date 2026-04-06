# TSK-06-01 리팩토링 리포트

## 점검 결과

| 파일 | 점검 항목 | 결과 | 조치 |
|------|----------|------|------|
| `frontend/src/config.ts` | 중복, 네이밍, 타입, 스타일 | 양호 | 변경 없음 |
| `frontend/src/components/SetupGate.tsx` | 중복, 네이밍, 타입, 스타일 | 양호 | 변경 없음 |
| `frontend/src/components/settings/SettingsContent.tsx` | 중복 호출, 추상화 일관성 | 개선 필요 | 수정 완료 |
| `frontend/src/components/__tests__/SetupGate.test.tsx` | 커버리지, 스타일 | 양호 | 변경 없음 |

## 수정 내역

### SettingsContent.tsx

| 항목 | Before | After |
|------|--------|-------|
| `getMode()` 중복 호출 | `getMode()` 2회 연속 호출 (312, 314행) | IIFE로 `isServer` 변수에 1회만 호출 |
| `localStorage` 직접 접근 | `localStorage.getItem('server_url')` | `getServerUrl()` 헬퍼 사용 |

**근거**: `getServerUrl()`는 이미 `config.ts`에 정의된 공용 헬퍼이며, `getMode()`와 동일한 추상화 수준을 유지해야 한다. 직접 `localStorage` 접근은 키 이름 변경 시 산재된 수정이 필요하므로 헬퍼로 통일한다.

## 테스트 결과

```
Test Files  2 passed (2)
     Tests  33 passed (33)
```

- `SetupGate.test.tsx`: 15 passed
- `ServerSetup.test.tsx`: 18 passed
