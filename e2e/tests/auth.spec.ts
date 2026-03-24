import { test, expect } from '@playwright/test';
import { createUser } from '../helpers/api';
import { loginViaUI, logoutViaUI } from '../helpers/auth';
import { Selectors } from '../helpers/selectors';

/**
 * 회원가입 / 로그인 E2E 테스트
 *
 * 실제 SignupPage: #name, #email, #password 입력 → button[type="submit"] 클릭 → /dashboard 이동
 * 실제 LoginPage:  #email, #password 입력 → button[type="submit"] 클릭 → /dashboard 이동
 */

test.describe('회원가입', () => {
  test('유효한 정보로 회원가입 후 대시보드로 이동', async ({ page }) => {
    const email = `signup-${Date.now()}@test.com`;

    await page.goto('/signup');
    await page.fill(Selectors.auth.nameInput, 'E2E 신규유저');
    await page.fill(Selectors.auth.emailInput, email);
    await page.fill(Selectors.auth.passwordInput, 'password123');
    await page.click(Selectors.auth.submitButton);

    await expect(page).toHaveURL('/dashboard');
  });

  test('중복 이메일로 회원가입 시 에러 메시지 표시', async ({ page }) => {
    const email = `dup-${Date.now()}@test.com`;
    // 먼저 해당 이메일로 사용자 생성
    await createUser({ email, password: 'password123', name: '기존유저' });

    await page.goto('/signup');
    await page.fill(Selectors.auth.nameInput, '중복유저');
    await page.fill(Selectors.auth.emailInput, email);
    await page.fill(Selectors.auth.passwordInput, 'password123');
    await page.click(Selectors.auth.submitButton);

    // 에러 메시지가 role="alert" 요소에 표시된다
    const errorAlert = page.locator(Selectors.auth.errorAlert);
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toContainText('회원가입에 실패');
  });
});

test.describe('로그인', () => {
  test('유효한 자격증명으로 로그인 후 대시보드로 이동', async ({ page }) => {
    const email = `login-${Date.now()}@test.com`;
    await createUser({ email, password: 'password123', name: '로그인유저' });

    await loginViaUI(page, email, 'password123');
    await expect(page).toHaveURL('/dashboard');
  });

  test('헤더에 사용자 이름이 표시된다', async ({ page }) => {
    const email = `login-name-${Date.now()}@test.com`;
    await createUser({ email, password: 'password123', name: '테스터이름' });

    await loginViaUI(page, email, 'password123');
    await expect(page).toHaveURL('/dashboard');

    // Header 컴포넌트: user.name을 span.font-medium으로 표시
    await expect(page.locator(Selectors.nav.userNameDisplay)).toContainText('테스터이름');
  });

  test('잘못된 비밀번호로 로그인 시 에러 메시지 표시', async ({ page }) => {
    const email = `login-bad-${Date.now()}@test.com`;
    await createUser({ email, password: 'password123', name: '유저' });

    await loginViaUI(page, email, 'wrongpassword');

    const errorAlert = page.locator(Selectors.auth.errorAlert);
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toContainText('이메일 또는 비밀번호');
  });

  test('존재하지 않는 이메일로 로그인 시 에러 메시지 표시', async ({ page }) => {
    await loginViaUI(page, 'notexist@test.com', 'password123');

    await expect(page.locator(Selectors.auth.errorAlert)).toBeVisible();
  });
});

test.describe('로그아웃', () => {
  test('로그아웃 후 보호된 페이지 접근 시 로그인 페이지로 이동', async ({ page }) => {
    const email = `logout-${Date.now()}@test.com`;
    await createUser({ email, password: 'password123', name: '로그아웃유저' });

    await loginViaUI(page, email, 'password123');
    await expect(page).toHaveURL('/dashboard');

    await logoutViaUI(page);

    // 로그아웃 후 보호 라우트 접근 시 /login으로 리디렉션
    await page.goto('/dashboard');
    await expect(page).toHaveURL('/login');
  });
});
