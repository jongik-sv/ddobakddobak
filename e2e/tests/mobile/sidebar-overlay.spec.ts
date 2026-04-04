import { expect, type Page } from '@playwright/test';
import { test } from '../../fixtures/data.fixture';
import { refreshAuthForPage } from '../../helpers/auth';
import { Selectors } from '../../helpers/selectors';

/**
 * 모바일 뷰포트: 사이드바 오버레이 시나리오
 *
 * 검증 항목:
 *  - 데스크톱 사이드바가 모바일에서 숨겨져 있는지
 *  - 메뉴 버튼(햄버거) 클릭 -> 사이드바 오버레이 열림
 *  - 오버레이 내 콘텐츠(폴더, 태그) 표시
 *  - 백드롭 클릭 -> 오버레이 닫힘
 *  - 오버레이 닫힌 후 메인 콘텐츠 정상 노출
 */
test.describe('모바일: 사이드바 오버레이', () => {
  test.beforeEach(async ({ authenticatedPage, testUser }) => {
    await refreshAuthForPage(authenticatedPage, testUser);
    await authenticatedPage.goto('/');
  });

  /** 햄버거 메뉴 클릭 -> 오버레이 열기 공통 동작 */
  async function openSidebarOverlay(page: Page) {
    await page.locator(Selectors.mobile.menuButton).click();
    const overlay = page.locator(Selectors.mobile.sidebarOverlay);
    await expect(overlay).toBeVisible();
    return overlay;
  }

  /** 백드롭 클릭 -> 오버레이 닫기 공통 동작 */
  async function closeSidebarOverlay(page: Page) {
    const backdrop = page.locator(Selectors.mobile.sidebarOverlayBackdrop);
    await backdrop.click({ force: true });
    await expect(page.locator(Selectors.mobile.sidebarOverlay)).not.toBeVisible();
  }

  test('데스크톱 사이드바가 모바일 뷰포트에서 숨겨져 있다', async ({
    authenticatedPage,
  }) => {
    const desktopSidebar = authenticatedPage.locator('[data-testid="sidebar"]');
    await expect(desktopSidebar).not.toBeVisible();
  });

  test('메뉴 버튼 클릭으로 사이드바 오버레이가 열린다', async ({
    authenticatedPage,
  }) => {
    // 햄버거 메뉴 버튼 클릭
    const menuButton = authenticatedPage.locator(Selectors.mobile.menuButton);
    await expect(menuButton).toBeVisible();
    await menuButton.click();

    // 사이드바 오버레이가 표시됨
    const overlay = authenticatedPage.locator(Selectors.mobile.sidebarOverlay);
    await expect(overlay).toBeVisible();

    // 백드롭도 표시됨
    const backdrop = authenticatedPage.locator(Selectors.mobile.sidebarOverlayBackdrop);
    await expect(backdrop).toBeVisible();
  });

  test('오버레이 내 사이드바 콘텐츠가 표시된다', async ({
    authenticatedPage,
  }) => {
    const overlay = await openSidebarOverlay(authenticatedPage);

    // 사이드바 내 내비게이션 항목이 표시됨
    const navItems = overlay.locator('a, button');
    await expect(navItems.first()).toBeVisible();
  });

  test('백드롭 클릭으로 오버레이가 닫힌다', async ({
    authenticatedPage,
  }) => {
    await openSidebarOverlay(authenticatedPage);
    await closeSidebarOverlay(authenticatedPage);
  });

  test('오버레이가 닫힌 후 메인 콘텐츠가 정상 노출된다', async ({
    authenticatedPage,
  }) => {
    await openSidebarOverlay(authenticatedPage);
    await closeSidebarOverlay(authenticatedPage);

    // 메인 콘텐츠 영역이 보이는지 확인
    const main = authenticatedPage.locator('main');
    await expect(main).toBeVisible();
  });
});
