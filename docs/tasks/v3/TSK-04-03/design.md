# TSK-04-03: 데스크톱 회귀 검증 - 설계

> status: design-done
> updated: 2026-04-04

---

## 구현 방향

- TSK-04-02에서 Playwright 설정에 모바일/태블릿 프로젝트가 추가되었으므로, 기존 데스크톱 E2E 테스트가 영향 없이 정상 실행되는지 회귀 검증한다.
- 뷰포트: `desktop-chromium` 프로젝트 (Desktop Chrome, 1280x720)
- 기존 6개 데스크톱 spec 파일(auth, export, meeting, minutes, pipeline, team)이 모두 등록되고, 모바일 테스트가 데스크톱 프로젝트에 포함되지 않는지 확인한다.
- 코드 변경 없이 검증만 수행하는 태스크.

---

## 검증 항목

| 검증 | 방법 | 기대 결과 |
|------|------|-----------|
| 데스크톱 테스트 목록 등록 | `npx playwright test --list --project=desktop-chromium` | 24개 테스트, 6개 spec 파일 |
| 모바일 테스트 격리 | 데스크톱 목록에 `mobile/` 경로 미포함 확인 | `testIgnore` 동작 |
| TypeScript 컴파일 | `tsc --noEmit` | 에러 없음 |
| 데스크톱 E2E 실행 | `npx playwright test --project=desktop-chromium` | 전체 통과 (서버 가용 시) |
| 주요 페이지 스모크 | auth, meeting, minutes, team, export, pipeline 흐름 검증 | 시각적 변경 없음 |

---

## 파일 계획

| 파일 경로 | 역할 | 신규/수정 |
|-----------|------|-----------|
| `docs/tasks/v3/TSK-04-03/design.md` | 설계 문서 | 신규 |
| `docs/tasks/v3/TSK-04-03/test-report.md` | 테스트 결과 리포트 | 신규 |

---

## 선행 조건

| 항목 | 설명 |
|------|------|
| **TSK-04-02** | Playwright 모바일 뷰포트 E2E 테스트 완료 (config 변경 적용됨) |
