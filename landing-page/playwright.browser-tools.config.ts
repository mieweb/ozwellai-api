import { defineConfig, devices } from '@playwright/test';

// All host assets and the cross-origin assistant fixture are route-backed.
// This POC suite needs no reference server, model, sign-in, or reserved port.
export default defineConfig({
  testDir: './tests',
  testMatch: 'browser-tools.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'line',
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 1080 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
