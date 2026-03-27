import { expect } from '@playwright/test';
import { test } from '../fixtures/data.fixture';
import { refreshAuthForPage } from '../helpers/auth';
import { allowCableConnection } from '../helpers/mock';
import { Selectors, RoutePatterns } from '../helpers/selectors';

/**
 * 회의록 확인 E2E 테스트
 *
 * MeetingLivePage (/meetings/:id/live) 기반으로 검증:
 *   - AI 요약 패널 (data-testid="ai-summary") 표시
 *   - 라이브 기록 영역
 *   - 메모 에디터 (MeetingEditor)
 */

test.describe('회의록 확인', () => {
  test.beforeEach(async ({ authenticatedPage, testUser }) => {
    await refreshAuthForPage(authenticatedPage, testUser);
  });

  test('완료된 회의 페이지에서 AI 요약 패널이 표시된다', async ({
    authenticatedPage,
    completedMeeting,
  }) => {
    await allowCableConnection(authenticatedPage);

    await authenticatedPage.goto(`/meetings/${completedMeeting.id}/live`);

    // AI 요약 패널 및 헤더 표시 확인
    await expect(authenticatedPage.locator(Selectors.aiSummary.panel)).toBeVisible();
    await expect(authenticatedPage.locator(Selectors.aiSummary.header)).toBeVisible();
  });

  test('라이브 기록 영역이 표시된다', async ({ authenticatedPage, completedMeeting }) => {
    await allowCableConnection(authenticatedPage);

    await authenticatedPage.goto(`/meetings/${completedMeeting.id}/live`);

    await expect(authenticatedPage.locator(Selectors.transcript.header)).toBeVisible();
  });

  test('메모 에디터가 표시된다', async ({ authenticatedPage, completedMeeting }) => {
    await allowCableConnection(authenticatedPage);

    await authenticatedPage.goto(`/meetings/${completedMeeting.id}/live`);

    // 메모 에디터 섹션 및 헤더 표시 확인
    await expect(authenticatedPage.locator(Selectors.memo.editor)).toBeVisible();
    await expect(authenticatedPage.locator(Selectors.memo.header)).toBeVisible();
  });

  test('AI 요약 없을 때 안내 메시지가 표시된다', async ({
    authenticatedPage,
    completedMeeting,
  }) => {
    // 요약 API를 빈 응답으로 mock: summary === null → 안내 메시지 표시
    await authenticatedPage.route(
      RoutePatterns.meetingSummary(completedMeeting.id),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(null),
        });
      }
    );
    await allowCableConnection(authenticatedPage);

    await authenticatedPage.goto(`/meetings/${completedMeeting.id}/live`);

    // AiSummaryPanel: summary === null 일 때 안내 메시지 표시
    await expect(
      authenticatedPage.locator(Selectors.aiSummary.emptyMessage)
    ).toBeVisible();
  });
});
