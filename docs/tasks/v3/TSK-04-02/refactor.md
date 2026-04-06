# TSK-04-02: 리팩토링 내역

## 변경 사항

| 파일 | 변경 내용 |
|------|-----------|
| e2e/playwright.config.ts | desktop-chromium 프로젝트의 중복 `testDir: './tests'` 제거 (최상위 testDir과 동일) |
| e2e/helpers/selectors.ts | `meeting.card` 셀렉터 추가하여 매직 문자열 `[data-testid="meeting-card"]` 제거 |
| e2e/tests/mobile/meeting-list-detail.spec.ts | 매직 문자열을 `Selectors.meeting.card`로 교체 (2곳) |
| e2e/tests/mobile/meeting-tabs.spec.ts | 5개 테스트에서 반복되던 `allowCableConnection` + `goto`를 `beforeEach`로 통합, 각 테스트에서 `completedMeeting` 파라미터 제거 |
| e2e/tests/mobile/sidebar-overlay.spec.ts | `beforeEach`에 `goto('/')` 통합, 반복되던 오버레이 열기/닫기 패턴을 `openSidebarOverlay`/`closeSidebarOverlay` 로컬 헬퍼로 추출 |
| e2e/tests/mobile/settings-modal.spec.ts | `beforeEach`에 `goto('/')` 통합, 반복되던 설정 모달 열기 패턴을 `openSettingsModal` 로컬 헬퍼로 추출 |

## 테스트 확인
- 결과: PASS
- `npx playwright test --list` 실행 결과 78개 테스트 전체 정상 표시 확인
