import type { Page } from '@playwright/test';
import { RoutePatterns } from './selectors';

/**
 * ActionCable WebSocket 연결을 pass-through로 허용한다.
 * cable 연결을 차단하지 않고 그대로 통과시켜 앱 초기화가 정상 진행되도록 한다.
 *
 * 여러 테스트에서 반복되는 아래 패턴을 대체한다:
 *   await page.route(RoutePatterns.cable, async (route) => { await route.continue(); });
 */
export async function allowCableConnection(page: Page): Promise<void> {
  await page.route(RoutePatterns.cable, async (route) => {
    await route.continue();
  });
}

/**
 * ActionCable WebSocket mock 헬퍼
 * page.addInitScript 로 __mockCableMessage__ 함수를 window에 노출한다.
 */
export async function setupCableMock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // TranscriptStore에 직접 상태를 주입하는 mock 함수
    // 실제 ActionCable 없이도 UI가 기록/요약을 표시할 수 있게 한다.
    (window as unknown as Record<string, unknown>).__E2E_MOCK_CABLE__ = true;

    // mock 메시지를 수신했을 때 CustomEvent로 전파
    (window as unknown as Record<string, unknown>).__mockCableMessage__ = (msg: unknown) => {
      window.dispatchEvent(
        new CustomEvent('__e2e_cable_message__', { detail: msg })
      );
    };
  });
}

/**
 * STT Sidecar HTTP/WebSocket 요청을 mock 처리
 */
export async function mockSidecarRoutes(page: Page): Promise<void> {
  // /api/v1/meetings/:id/start → 200
  await page.route('**/api/v1/meetings/*/start', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 1, status: 'recording' }),
    });
  });

  // /api/v1/meetings/:id/stop → 200
  await page.route('**/api/v1/meetings/*/stop', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 1, status: 'stopped' }),
    });
  });

  // /api/v1/meetings/:id/audio → 200
  await page.route('**/api/v1/meetings/*/audio', async (route) => {
    await route.fulfill({ status: 200 });
  });
}
