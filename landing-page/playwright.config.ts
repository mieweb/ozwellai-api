import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Ozwell landing page tests.
 * 
 * These tests verify the embed widget functionality including:
 * - Widget loading and initialization
 * - Chat interactions with the AI
 * - Tool calls (update_form_data)
 * - iframe-sync state synchronization
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  
  use: {
    // Base URL for the landing page server
    baseURL: 'http://localhost:8080',
    
    // Collect trace when retrying the failed test
    trace: 'on-first-retry',
    
    // Screenshot on failure
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Run local servers before starting the tests
  // In CI, servers are started by the workflow before Playwright runs
  // Locally, these commands will start the servers if not already running
  webServer: [
    {
      command: 'cd ../reference-server && npm run dev',
      url: 'http://localhost:3000/embed/ozwell-loader.js',
      reuseExistingServer: true,  // Skip if server is already running (e.g., in CI)
      timeout: 60000,
    },
    {
      command: 'npm start',
      url: 'http://localhost:8080',
      reuseExistingServer: true,  // Skip if server is already running (e.g., in CI)
      timeout: 30000,
    },
  ],
});
