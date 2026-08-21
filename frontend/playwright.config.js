import { defineConfig, devices } from '@playwright/test';

/* 验收跑在真实浏览器上。默认打 dev server；
   BASE_URL 可以指到 preview / 部署环境跑同一套流程。 */
const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      testIgnore: /mobile\.spec\.js/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      /* iPhone 13 的视口 + 触摸，但引擎用 Chromium：
         这台机器上的 Playwright WebKit 一启动就 Bus error（环境问题，不是应用问题），
         所以移动端验收跑在 Chromium 上。真机 Safari 仍需另行验证。 */
      name: 'mobile',
      testMatch: /mobile\.spec\.js/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 664 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
