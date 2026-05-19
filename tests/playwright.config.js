import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './playwright',
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:3737',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'mocked',
      testMatch: /.*\.mock\.test\.js/,
      // Mocked tests don't need the server
    },
    {
      name: 'live',
      testMatch: /.*\.live\.test\.js/,
      // Live tests need the battle-log server running
    },
    {
      name: 'demo',
      testMatch: /demo-walkthrough\.test\.js/,
      use: {
        headless: false,
        launchOptions: { slowMo: 200 },
        viewport: { width: 1920, height: 1080 },
      },
      timeout: 120000,
    },
  ],
  webServer: {
    command: 'node ../battle-log/server.js --port 3737',
    port: 3737,
    timeout: 10000,
    reuseExistingServer: true,
  },
});
