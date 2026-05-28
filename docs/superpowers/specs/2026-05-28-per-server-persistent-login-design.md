# 서버별 영속 로그인 (Per-Server Persistent Login)

날짜: 2026-05-28
대상: 모바일/데스크톱 Tauri 앱 + 웹

## 문제

현재 토큰은 서버 구분 없이 단일 쌍으로 localStorage에 저장된다
(`access_token`, `refresh_token`, `auth_user`). 서버 A 로그인 후 서버 B로
전환하면 A의 토큰이 B 요청에 그대로 전송되어 401 → refresh 실패(B는 A의 jti를
모름) → 강제 로그아웃. A로 돌아와도 토큰이 이미 삭제되어 재로그인이 필요하다.

토큰 수명은 충분하다(access 24h, refresh 30일 — `jwt_service.rb`). 문제는 저장
**구조**다.

## 목표

- 한 서버에 로그인하면 로그아웃 전까지 그 서버 로그인 유지.
- 다른 서버에 접속했다가 원래 서버로 돌아오면 자동 로그인(refresh 유효 시).
- 로그아웃은 현재 서버 세션만 삭제, 다른 서버 세션 보존.
- 백엔드 무수정.

## 결정 사항 (확정)

- 로그아웃 범위: **현재 서버만**.
- 저장 위치: **localStorage 유지** (시큐어 스토어는 별도 작업).
- 만료 토큰: **앱 시작 시 정리**.

## 설계

### 자료구조

세션 맵을 단일 localStorage 키 `auth_sessions`에 저장:

```ts
// localStorage["auth_sessions"] = JSON
{
  "http://10.110.1.12:13323": { accessToken, refreshToken, user, refreshExp },
  "http://192.168.0.5:13323":  { accessToken, refreshToken, user, refreshExp }
}
```

- 키 = 서버 식별자(`getServerKey()`). 값 = `AuthSession`.
- `refreshExp` = refresh JWT의 `exp` 클레임(초). 디코드 실패 시 `null`(만료 정리
  대상 제외).
- 기존 mirror 키(`access_token`/`refresh_token`/`auth_user`)는 마이그레이션용으로
  계속 기록(외부에서 직접 읽는 코드 없음 — 전부 zustand 스토어 경유 확인).

### 서버 키 (`config.ts`에 `getServerKey()` 추가)

- 로컬 모드 → `'local'`
- 웹(`!IS_TAURI`) → `window.location.origin`
- 모바일/데스크톱 서버 모드 → `getServerUrl()`

### 컴포넌트

| 파일 | 변경 |
|------|------|
| `lib/authSessions.ts` (신규) | 세션 맵 read/write/remove + `pruneExpired()` + `decodeJwtExp()`. 순수 함수, 단독 테스트 |
| `config.ts` | `getServerKey()` 추가 |
| `stores/authStore.ts` | 초기화를 세션 맵에서 hydrate(없으면 mirror에서 마이그레이션). `setTokens`/`setAccessToken`/`setUser`는 현재 서버 세션 갱신, `clearAuth`는 현재 서버 세션만 삭제 |
| `hooks/useAuth.ts` | 변경 최소(기존 흐름 그대로 동작) |

`ServerSetup.tsx`는 **수정 불필요**. 서버 전환 시 `server_url` 갱신 후 전체
페이지 reload → 모듈 재로드 → 스토어가 새 서버 키로 재초기화 → 세션 있으면
자동 인증.

### 데이터 흐름

**로그인(서버 A)**: `setTokens` → 세션맵[A] = {tokens, refreshExp}, mirror 기록.
`setUser` → 세션맵[A].user 채움.

**서버 전환(A→B)**: `server_url=B` 저장 → reload. 스토어 재초기화가 세션맵[B]
조회. 있고 `refreshExp` 미래 → accessToken hydrate → useAuth가 `markAuthenticated`
→ **자동 로그인**. 없으면 로그인 화면. 세션맵[A]는 보존.

**만료 정리**: 모듈 로드 시 `pruneExpired()` — `refreshExp < now`인 키 삭제.
현재 서버 세션이 만료여도 기존 흐름(validate→refresh 실패→clearAuth)이 정리.

**로그아웃**: 백엔드 revoke 호출 후 `clearAuth` — 세션맵[현재키]만 삭제 + mirror
+ state 초기화. 다른 서버 세션 유지.

### 에러 처리

- `auth_sessions` JSON 파싱 실패 → `{}` 반환(손상 시 초기화).
- JWT exp 디코드 실패 → `null`(만료 정리 안 함, 기존 401 흐름이 처리).

## 테스트

`__tests__/lib/authSessions.test.ts`:
- save → get 라운드트립
- remove는 해당 키만 삭제
- pruneExpired는 과거 exp만 삭제, null/미래 보존
- decodeJwtExp: 유효 토큰 exp 추출, 잘못된 토큰 → null
- 손상 JSON → 빈 맵

## 비목표 (YAGNI)

- OS 시큐어 스토어 암호화(별도 작업).
- 서버별 동시 멀티 로그인 UI(활성 서버는 항상 하나).
- 백엔드 변경.
