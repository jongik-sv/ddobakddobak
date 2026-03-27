import { expect } from '@playwright/test';
import { test } from '../fixtures/data.fixture';
import { refreshAuthForPage } from '../helpers/auth';
import { createMeetingViaApi } from '../helpers/api';
import { allowCableConnection } from '../helpers/mock';
import { Selectors } from '../helpers/selectors';

/**
 * 회의 생성 / 목록 / 상세 E2E 테스트
 *
 * 앱 라우트:
 *   - /meetings/:id/live  → MeetingLivePage (실시간 회의)
 *
 * 현재 앱에는 독립적인 회의 목록 페이지가 없으므로
 * DashboardPage(/dashboard) 기반으로 테스트하고,
 * 회의 생성 API + 직접 URL 이동으로 상세 검증한다.
 */

test.describe('회의 생성 및 상세 확인', () => {
  test.beforeEach(async ({ authenticatedPage, testUser }) => {
    // fixture의 authenticatedPage는 초기 토큰을 주입하지만,
    // 각 테스트 전에 최신 토큰으로 갱신하여 인증 상태를 보장한다.
    await refreshAuthForPage(authenticatedPage, testUser);
  });

  test('회의를 API로 생성하고 상세 페이지에 진입할 수 있다', async ({
    authenticatedPage,
    testUser,
    testTeam,
  }) => {
    const meeting = await createMeetingViaApi(testUser.token, {
      title: '분기 리뷰 회의',
      team_id: testTeam.id,
    });

    await authenticatedPage.goto(`/meetings/${meeting.id}/live`);

    // MeetingLivePage: 헤더에 "회의 진행" 텍스트
    await expect(
      authenticatedPage.locator(Selectors.meeting.pageHeader, { hasText: '회의 진행' })
    ).toBeVisible();
  });

  test('회의 라이브 페이지에서 회의 시작/종료 버튼이 표시된다', async ({
    authenticatedPage,
    testUser,
    testTeam,
  }) => {
    const meeting = await createMeetingViaApi(testUser.token, {
      title: '버튼 확인 회의',
      team_id: testTeam.id,
    });

    // API 라우트 mock: 실제 STT 없이도 버튼 동작 확인
    await authenticatedPage.route('**/api/v1/meetings/*/start', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: meeting.id, status: 'recording' }),
      });
    });
    await authenticatedPage.route('**/api/v1/meetings/*/stop', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: meeting.id, status: 'stopped' }),
      });
    });
    await allowCableConnection(authenticatedPage);

    await authenticatedPage.goto(`/meetings/${meeting.id}/live`);

    // 회의 시작 버튼 표시
    const startBtn = authenticatedPage.locator('button', { hasText: '회의 시작' });
    await expect(startBtn).toBeVisible();
    await expect(startBtn).toBeEnabled();

    // 회의 종료 버튼은 비활성 (회의 시작 전)
    const stopBtn = authenticatedPage.locator('button', { hasText: '회의 종료' });
    await expect(stopBtn).toBeVisible();
    await expect(stopBtn).toBeDisabled();
  });

  test('회의 라이브 페이지에 3영역(기록/AI요약/메모)이 표시된다', async ({
    authenticatedPage,
    testUser,
    testTeam,
  }) => {
    const meeting = await createMeetingViaApi(testUser.token, {
      title: '레이아웃 확인 회의',
      team_id: testTeam.id,
    });

    await allowCableConnection(authenticatedPage);

    await authenticatedPage.goto(`/meetings/${meeting.id}/live`);

    // 라이브 기록 섹션
    await expect(authenticatedPage.locator(Selectors.transcript.header)).toBeVisible();

    // AI 요약 섹션
    await expect(authenticatedPage.locator(Selectors.aiSummary.panel)).toBeVisible();

    // 메모 에디터 섹션
    await expect(authenticatedPage.locator(Selectors.memo.editor)).toBeVisible();
  });
});
