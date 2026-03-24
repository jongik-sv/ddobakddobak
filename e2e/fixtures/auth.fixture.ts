import { test as base, type Page } from '@playwright/test';
import { createUser, deleteUserViaApi, loginViaApi, type TestUser } from '../helpers/api';
import { injectAuthToken } from '../helpers/auth';

type AuthFixtures = {
  testUser: TestUser;
  authenticatedPage: Page;
};

export const test = base.extend<AuthFixtures>({
  testUser: async ({}, use) => {
    const email = `e2e-${Date.now()}@test.com`;
    const password = 'password123';
    const name = 'E2E 테스터';

    const user = await createUser({ email, password, name });
    await use(user);

    // teardown: 테스트 사용자 삭제 (실패해도 무시)
    try {
      await deleteUserViaApi(user.token, user.id);
    } catch {
      // 무시
    }
  },

  authenticatedPage: async ({ page, testUser }, use) => {
    // 앱 루트를 한번 방문하여 localStorage 접근 컨텍스트를 만든다
    await page.goto('/');

    // API로 최신 토큰 취득 후 localStorage 주입
    const authData = await loginViaApi({
      email: testUser.email,
      password: testUser.password,
    });
    await injectAuthToken(page, authData.token, authData.user);

    // 인증 상태 적용을 위해 reload
    await page.reload();

    await use(page);
  },
});

export { expect } from '@playwright/test';
