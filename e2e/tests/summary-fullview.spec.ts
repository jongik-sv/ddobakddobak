import { expect } from '@playwright/test';
import { test } from '../fixtures/data.fixture';
import { refreshAuthForPage } from '../helpers/auth';
import { allowCableConnection } from '../helpers/mock';
import { Selectors } from '../helpers/selectors';

/**
 * AI 회의록 "전체보기" 확장 팝업 E2E (데스크톱 떠 있는 창)
 *   - 확장 버튼(aria-label="전체보기")으로 오픈
 *   - 헤더 드래그로 위치 이동 / 우하단 핸들로 리사이즈
 *   - X / Esc 닫힘, 재오픈 시 직전 크기 복원(localStorage)
 */

const EXPAND_BTN = 'button[aria-label="전체보기"]';
const WIN = '[data-testid="ai-summary-fullview-window"]';
const DRAG_HANDLE = '.ai-summary-drag-handle';
const CLOSE_BTN = `${WIN} button[aria-label="닫기"]`;

test.describe('AI 회의록 확장 팝업 (드래그·리사이즈)', () => {
  test.beforeEach(async ({ authenticatedPage, testUser }) => {
    await refreshAuthForPage(authenticatedPage, testUser);
  });

  async function openFullView(page, meetingId: number) {
    await allowCableConnection(page);
    await page.goto(`/meetings/${meetingId}/live`);
    await expect(page.locator(Selectors.aiSummary.panel)).toBeVisible();
    await page.locator(`${Selectors.aiSummary.panel} ${EXPAND_BTN}`).click();
    await expect(page.locator(WIN)).toBeVisible();
  }

  test('확장 버튼으로 팝업이 열린다', async ({ authenticatedPage, completedMeeting }) => {
    await openFullView(authenticatedPage, completedMeeting.id);
    await expect(authenticatedPage.locator(DRAG_HANDLE)).toBeVisible();
  });

  test('헤더 드래그로 위치가 이동한다', async ({ authenticatedPage, completedMeeting }) => {
    await openFullView(authenticatedPage, completedMeeting.id);
    const win = authenticatedPage.locator(WIN);
    const before = await win.boundingBox();
    if (!before) throw new Error('no bbox before drag');
    const handle = authenticatedPage.locator(DRAG_HANDLE);
    const hb = await handle.boundingBox();
    if (!hb) throw new Error('no handle bbox');
    await authenticatedPage.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await authenticatedPage.mouse.down();
    await authenticatedPage.mouse.move(hb.x + hb.width / 2 - 400, hb.y + hb.height / 2 - 300, { steps: 12 });
    await authenticatedPage.mouse.up();
    await authenticatedPage.waitForTimeout(150);
    const after = await win.boundingBox();
    if (!after) throw new Error('no bbox after drag');
    expect(before.x - after.x).toBeGreaterThan(40);
    expect(before.y - after.y).toBeGreaterThan(40);
  });

  test('우하단 핸들 드래그로 크기가 바뀐다', async ({ authenticatedPage, completedMeeting }) => {
    await openFullView(authenticatedPage, completedMeeting.id);
    const win = authenticatedPage.locator(WIN);
    const before = await win.boundingBox();
    if (!before) throw new Error('no bbox before resize');
    await authenticatedPage.mouse.move(before.x + before.width - 3, before.y + before.height - 3);
    await authenticatedPage.mouse.down();
    await authenticatedPage.mouse.move(before.x + before.width - 3 - 250, before.y + before.height - 3 - 180, { steps: 12 });
    await authenticatedPage.mouse.up();
    await authenticatedPage.waitForTimeout(150);
    const after = await win.boundingBox();
    if (!after) throw new Error('no bbox after resize');
    expect(after.width).toBeLessThan(before.width - 50);
    expect(after.height).toBeLessThan(before.height - 50);
  });

  test('X 버튼으로 닫힌다', async ({ authenticatedPage, completedMeeting }) => {
    await openFullView(authenticatedPage, completedMeeting.id);
    await authenticatedPage.locator(CLOSE_BTN).click();
    await expect(authenticatedPage.locator(WIN)).toBeHidden();
  });

  test('Esc 키로 닫힌다', async ({ authenticatedPage, completedMeeting }) => {
    await openFullView(authenticatedPage, completedMeeting.id);
    await authenticatedPage.keyboard.press('Escape');
    await expect(authenticatedPage.locator(WIN)).toBeHidden();
  });

  test('재오픈 시 직전 크기가 복원된다', async ({ authenticatedPage, completedMeeting }) => {
    await openFullView(authenticatedPage, completedMeeting.id);
    const win = authenticatedPage.locator(WIN);
    const start = await win.boundingBox();
    if (!start) throw new Error('no start bbox');
    await authenticatedPage.mouse.move(start.x + start.width - 3, start.y + start.height - 3);
    await authenticatedPage.mouse.down();
    await authenticatedPage.mouse.move(start.x + start.width - 3 - 300, start.y + start.height - 3 - 200, { steps: 12 });
    await authenticatedPage.mouse.up();
    await authenticatedPage.waitForTimeout(150);
    const resized = await win.boundingBox();
    if (!resized) throw new Error('no resized bbox');
    await authenticatedPage.keyboard.press('Escape');
    await expect(win).toBeHidden();
    await authenticatedPage.locator(`${Selectors.aiSummary.panel} ${EXPAND_BTN}`).click();
    await expect(win).toBeVisible();
    const reopened = await win.boundingBox();
    if (!reopened) throw new Error('no reopened bbox');
    expect(Math.abs(reopened.width - resized.width)).toBeLessThan(8);
    expect(Math.abs(reopened.height - resized.height)).toBeLessThan(8);
  });
});
