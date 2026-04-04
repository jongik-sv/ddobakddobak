import { expect } from '@playwright/test';
import { test } from '../../fixtures/data.fixture';
import { refreshAuthForPage } from '../../helpers/auth';
import { allowCableConnection } from '../../helpers/mock';
import { Selectors } from '../../helpers/selectors';

/**
 * 모바일 뷰포트: 회의 상세 탭 전환 시나리오
 *
 * 검증 항목:
 *  - 기본 탭(전사) 콘텐츠가 보이는지
 *  - "요약" 탭 클릭 -> AI 요약 패널 표시, 전사 패널 숨김
 *  - "메모" 탭 클릭 -> 메모 에디터 표시, 다른 패널 숨김
 *  - 탭 전환 후 원래 탭으로 돌아왔을 때 콘텐츠 유지
 *  - aria-selected 속성으로 활성 탭 상태 검증
 */
test.describe('모바일: 회의 상세 탭 전환', () => {
  test.beforeEach(async ({ authenticatedPage, testUser, completedMeeting }) => {
    await refreshAuthForPage(authenticatedPage, testUser);
    await allowCableConnection(authenticatedPage);
    await authenticatedPage.goto(`/meetings/${completedMeeting.id}`);
  });

  test('기본 탭(전사)이 활성 상태이고 콘텐츠가 표시된다', async ({
    authenticatedPage,
  }) => {
    // 모바일 탭 바 표시 확인
    const tabBar = authenticatedPage.locator(Selectors.mobileTabs.tabBar);
    await expect(tabBar).toBeVisible();

    // "전사" 탭이 활성 상태 (aria-selected="true")
    const transcriptTab = authenticatedPage.locator(Selectors.mobileTabs.tab('전사'));
    await expect(transcriptTab).toHaveAttribute('aria-selected', 'true');

    // 전사 콘텐츠 영역이 표시됨
    const tabContent = authenticatedPage.locator(Selectors.mobileTabs.tabContent);
    await expect(tabContent).toBeVisible();
    await expect(authenticatedPage.locator(Selectors.transcript.header)).toBeVisible();
  });

  test('"요약" 탭 클릭 시 AI 요약이 표시되고 전사가 숨겨진다', async ({
    authenticatedPage,
  }) => {
    // "요약" 탭 클릭
    const summaryTab = authenticatedPage.locator(Selectors.mobileTabs.tab('요약'));
    await summaryTab.click();

    // 요약 탭이 활성 상태
    await expect(summaryTab).toHaveAttribute('aria-selected', 'true');

    // 전사 탭은 비활성 상태
    const transcriptTab = authenticatedPage.locator(Selectors.mobileTabs.tab('전사'));
    await expect(transcriptTab).toHaveAttribute('aria-selected', 'false');

    // AI 요약 패널이 표시됨
    await expect(authenticatedPage.locator(Selectors.aiSummary.panel)).toBeVisible();

    // 전사 헤더가 숨겨짐
    await expect(authenticatedPage.locator(Selectors.transcript.header)).not.toBeVisible();
  });

  test('"메모" 탭 클릭 시 메모 에디터가 표시되고 다른 패널이 숨겨진다', async ({
    authenticatedPage,
  }) => {
    // "메모" 탭 클릭
    const memoTab = authenticatedPage.locator(Selectors.mobileTabs.tab('메모'));
    await memoTab.click();

    // 메모 탭이 활성 상태
    await expect(memoTab).toHaveAttribute('aria-selected', 'true');

    // 메모 에디터가 표시됨
    await expect(authenticatedPage.locator(Selectors.memo.editor)).toBeVisible();

    // 전사, 요약은 숨겨짐
    await expect(authenticatedPage.locator(Selectors.transcript.header)).not.toBeVisible();
    await expect(authenticatedPage.locator(Selectors.aiSummary.panel)).not.toBeVisible();
  });

  test('탭 전환 후 원래 탭으로 돌아왔을 때 콘텐츠가 유지된다', async ({
    authenticatedPage,
  }) => {
    // 전사 콘텐츠 확인
    await expect(authenticatedPage.locator(Selectors.transcript.header)).toBeVisible();

    // 요약 탭으로 전환
    await authenticatedPage.locator(Selectors.mobileTabs.tab('요약')).click();
    await expect(authenticatedPage.locator(Selectors.aiSummary.panel)).toBeVisible();

    // 다시 전사 탭으로 전환
    await authenticatedPage.locator(Selectors.mobileTabs.tab('전사')).click();

    // 전사 콘텐츠가 다시 표시됨
    await expect(authenticatedPage.locator(Selectors.transcript.header)).toBeVisible();

    // 전사 탭이 활성 상태
    const transcriptTab = authenticatedPage.locator(Selectors.mobileTabs.tab('전사'));
    await expect(transcriptTab).toHaveAttribute('aria-selected', 'true');
  });

  test('활성 탭의 aria-selected 상태가 올바르게 전환된다', async ({
    authenticatedPage,
  }) => {
    const activeTab = authenticatedPage.locator(Selectors.mobileTabs.activeTab);

    // 초기: 전사 탭 활성
    await expect(activeTab).toHaveText(/전사/);

    // 요약 클릭
    await authenticatedPage.locator(Selectors.mobileTabs.tab('요약')).click();
    await expect(activeTab).toHaveText(/요약/);

    // 메모 클릭
    await authenticatedPage.locator(Selectors.mobileTabs.tab('메모')).click();
    await expect(activeTab).toHaveText(/메모/);
  });
});
