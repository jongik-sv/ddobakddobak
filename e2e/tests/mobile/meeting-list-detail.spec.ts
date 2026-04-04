import { expect } from '@playwright/test';
import { test } from '../../fixtures/data.fixture';
import { refreshAuthForPage } from '../../helpers/auth';
import { Selectors } from '../../helpers/selectors';

/**
 * 모바일 뷰포트: 회의 목록 -> 상세 이동 시나리오
 *
 * 검증 항목:
 *  - 바텀 내비게이션이 화면에 표시되는지
 *  - "회의" 탭으로 회의 목록 페이지 이동
 *  - 회의 카드가 1컬럼으로 렌더링되는지
 *  - 회의 카드 클릭 -> 상세 페이지 진입
 *  - 상세 페이지에서 모바일 탭 바(전사/요약/메모)가 표시되는지
 */
test.describe('모바일: 회의 목록 -> 상세 이동', () => {
  test.beforeEach(async ({ authenticatedPage, testUser }) => {
    await refreshAuthForPage(authenticatedPage, testUser);
  });

  test('바텀 내비게이션이 모바일 뷰포트에서 표시된다', async ({
    authenticatedPage,
  }) => {
    await authenticatedPage.goto('/');

    const bottomNav = authenticatedPage.locator(Selectors.mobile.bottomNav);
    await expect(bottomNav).toBeVisible();
  });

  test('"회의" 바텀 내비 탭으로 회의 목록 페이지 이동', async ({
    authenticatedPage,
  }) => {
    await authenticatedPage.goto('/');

    const meetingNavItem = authenticatedPage.locator(
      Selectors.mobile.bottomNavItem('회의')
    );
    await expect(meetingNavItem).toBeVisible();
    await meetingNavItem.click();

    // 회의 목록 페이지로 이동 확인
    await expect(authenticatedPage).toHaveURL(/\/meetings/);
  });

  test('회의 카드가 모바일에서 1컬럼으로 렌더링된다', async ({
    authenticatedPage,
    completedMeeting,
  }) => {
    await authenticatedPage.goto('/meetings');

    // 회의 카드가 표시될 때까지 대기
    const meetingCards = authenticatedPage.locator(Selectors.meeting.card);
    await expect(meetingCards.first()).toBeVisible();

    // 카드 너비가 뷰포트 너비와 근사한지 확인 (1컬럼)
    const viewportSize = authenticatedPage.viewportSize();
    const cardBox = await meetingCards.first().boundingBox();
    expect(cardBox).not.toBeNull();
    if (cardBox && viewportSize) {
      // 카드 너비가 뷰포트 너비의 85% 이상이면 1컬럼으로 판단
      // (padding/margin 고려)
      expect(cardBox.width).toBeGreaterThan(viewportSize.width * 0.85);
    }
  });

  test('회의 카드 클릭으로 상세 페이지에 진입하면 모바일 탭 바가 표시된다', async ({
    authenticatedPage,
    completedMeeting,
  }) => {
    await authenticatedPage.goto('/meetings');

    // 회의 카드 클릭
    const meetingCard = authenticatedPage.locator(Selectors.meeting.card).first();
    await expect(meetingCard).toBeVisible();
    await meetingCard.click();

    // 상세 페이지 진입 확인
    await expect(authenticatedPage).toHaveURL(/\/meetings\/\d+/);

    // 모바일 탭 바 표시 확인
    const tabBar = authenticatedPage.locator(Selectors.mobileTabs.tabBar);
    await expect(tabBar).toBeVisible();

    // 전사/요약/메모 탭이 존재하는지 확인
    await expect(
      authenticatedPage.locator(Selectors.mobileTabs.tab('전사'))
    ).toBeVisible();
    await expect(
      authenticatedPage.locator(Selectors.mobileTabs.tab('요약'))
    ).toBeVisible();
    await expect(
      authenticatedPage.locator(Selectors.mobileTabs.tab('메모'))
    ).toBeVisible();
  });
});
