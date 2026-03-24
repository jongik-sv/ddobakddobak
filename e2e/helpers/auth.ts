import type { Page } from '@playwright/test';
import { loginViaApi } from './api';
import type { TestUser } from './api';

/**
 * localStorage의 auth-storage (zustand persist) 에 JWT 토큰과 사용자 정보를 주입한다.
 * 실제 앱은 zustand/middleware persist 키 `auth-storage` 를 사용한다.
 */
export async function injectAuthToken(
  page: Page,
  token: string,
  user: { id: number; email: string; name: string }
): Promise<void> {
  await page.evaluate(
    ({ token, user }) => {
      const authState = {
        state: {
          token,
          user,
          isAuthenticated: true,
        },
        version: 0,
      };
      localStorage.setItem('auth-storage', JSON.stringify(authState));
    },
    { token, user }
  );
}

/**
 * 로그인 페이지를 통해 UI 로그인을 수행한다.
 */
export async function loginViaUI(
  page: Page,
  email: string,
  password: string
): Promise<void> {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');
}

/**
 * 로그아웃 버튼 클릭
 */
export async function logoutViaUI(page: Page): Promise<void> {
  await page.click('button[aria-label="로그아웃"]');
}

/**
 * 여러 테스트 파일의 beforeEach에서 반복되는 패턴을 통합한다.
 *
 * 대체 패턴:
 *   const authData = await loginViaApi({ email: testUser.email, password: testUser.password });
 *   await injectAuthToken(authenticatedPage, authData.token, authData.user);
 */
export async function refreshAuthForPage(page: Page, testUser: TestUser): Promise<void> {
  const authData = await loginViaApi({ email: testUser.email, password: testUser.password });
  await injectAuthToken(page, authData.token, authData.user);
}
