import { expect, type Page, type Locator } from '@playwright/test';
import { test } from '../../fixtures/data.fixture';
import { refreshAuthForPage } from '../../helpers/auth';
import { Selectors } from '../../helpers/selectors';

/**
 * 모바일 뷰포트: 설정 모달 풀스크린 시나리오
 *
 * 검증 항목:
 *  - 설정 버튼 클릭으로 모달 열기
 *  - 모달이 풀스크린으로 표시되는지 (뷰포트 전체 차지)
 *  - 모달 내 설정 탭/콘텐츠 정상 표시
 *  - 모달 닫기 동작
 */
test.describe('모바일: 설정 모달 풀스크린', () => {
  test.beforeEach(async ({ authenticatedPage, testUser }) => {
    await refreshAuthForPage(authenticatedPage, testUser);
    await authenticatedPage.goto('/');
  });

  /** "설정" 바텀 내비 클릭 -> 풀스크린 모달 열기 공통 동작 */
  async function openSettingsModal(page: Page): Promise<Locator> {
    await page.locator(Selectors.mobile.bottomNavItem('설정')).click();
    const modal = page.locator(Selectors.settings.fullscreenModal);
    await expect(modal).toBeVisible();
    return modal;
  }

  test('설정 버튼 클릭으로 풀스크린 모달이 열린다', async ({
    authenticatedPage,
  }) => {
    // 바텀 내비의 "설정" 항목 클릭
    const settingsNavItem = authenticatedPage.locator(
      Selectors.mobile.bottomNavItem('설정')
    );
    await expect(settingsNavItem).toBeVisible();
    await settingsNavItem.click();

    // 풀스크린 모달이 표시됨
    const modal = authenticatedPage.locator(Selectors.settings.fullscreenModal);
    await expect(modal).toBeVisible();
  });

  test('설정 모달이 뷰포트 전체를 차지한다', async ({
    authenticatedPage,
  }) => {
    const modal = await openSettingsModal(authenticatedPage);

    // 모달 크기가 뷰포트 크기와 근사한지 확인
    const viewportSize = authenticatedPage.viewportSize();
    const modalBox = await modal.boundingBox();
    expect(modalBox).not.toBeNull();
    if (modalBox && viewportSize) {
      expect(modalBox.width).toBeGreaterThanOrEqual(viewportSize.width * 0.95);
      expect(modalBox.height).toBeGreaterThanOrEqual(viewportSize.height * 0.9);
    }
  });

  test('모달 내 설정 콘텐츠가 정상 표시된다', async ({
    authenticatedPage,
  }) => {
    const modal = await openSettingsModal(authenticatedPage);

    // 모달 내부에 최소한 하나의 설정 항목/섹션이 표시됨
    const settingsContent = modal.locator('h2, h3, label, [role="tablist"]');
    await expect(settingsContent.first()).toBeVisible();
  });

  test('설정 모달을 닫을 수 있다', async ({
    authenticatedPage,
  }) => {
    const modal = await openSettingsModal(authenticatedPage);

    // 닫기 버튼 클릭 (X 버튼 또는 aria-label="닫기")
    const closeButton = modal.locator(
      'button[aria-label="닫기"], button:has-text("닫기"), button:has-text("X")'
    );
    await closeButton.first().click();

    // 모달이 닫힘
    await expect(modal).not.toBeVisible();
  });
});
