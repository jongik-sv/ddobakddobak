# TSK-01-04 테스트 보고서

## 실행 결과

- **테스트 파일**: 7개
- **테스트 케이스**: 26개
- **통과**: 26개
- **실패**: 0개

## 테스트 목록

| 파일 | 테스트 | 결과 |
|---|---|---|
| `api/auth.test.ts` | login POST 요청, token/user 반환 (2) | ✅ |
| `api/auth.test.ts` | signup POST 요청, token/user 반환 (2) | ✅ |
| `stores/authStore.test.ts` | 초기상태, setUser, setToken, login, logout (5) | ✅ |
| `pages/LoginPage.test.tsx` | 렌더링, 이메일/비밀번호 필드, 성공 리다이렉트, 실패 에러, 회원가입 링크 (6) | ✅ |
| `pages/SignupPage.test.tsx` | 렌더링, 입력필드, 성공 리다이렉트, 실패 에러, 로그인 링크 (5) | ✅ |
| `components/PrivateRoute.test.tsx` | 미인증 리다이렉트, 인증 시 콘텐츠 표시 (2) | ✅ |
| `pages/HomePage.test.tsx` (기존) | 기존 테스트 (4) | ✅ |

## 이슈 및 해결

- **vi.mock 호이스팅 오류**: `const` 변수를 mock factory 내에서 참조 시 초기화 전 접근 오류 발생
  → `vi.hoisted()` 패턴으로 해결
