import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  // 단일 테스트 최대 실행 시간 (기본 30s)
  timeout: 30_000,
  // expect() assertion 대기 시간
  expect: { timeout: 10_000 },
  reporter: [
    ['html', { outputFolder: 'reports/html' }],
    ['list'],
  ],
  use: {
    baseURL: 'http://localhost:13325',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    locale: 'ko-KR',
    headless: true,
    // 개별 action(click/fill 등) 최대 대기 시간
    actionTimeout: 15_000,
    // 페이지 네비게이션 최대 대기 시간
    navigationTimeout: 20_000,
  },
  projects: [
    // --- 데스크톱 (기존) ---
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: ['**/mobile/**'],
    },

    // --- 모바일: Android ---
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'] },
      testDir: './tests/mobile',
    },

    // --- 모바일: iOS ---
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 14'] },
      testDir: './tests/mobile',
    },

    // --- 태블릿: iPad ---
    {
      name: 'tablet-safari',
      use: { ...devices['iPad (gen 7)'] },
      testDir: './tests/mobile',
    },
  ],
  globalSetup: './global-setup.ts',
  webServer: [
    {
      command: 'cd ../backend && bundle exec rails server -p 13323 -e test',
      url: 'http://localhost:13323/api/v1/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'cd ../frontend && npm run dev -- --port 13325',
      url: 'http://localhost:13325',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
