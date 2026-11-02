import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  use: {
    channel: 'chrome',
    headless: true,
    baseURL: 'http://127.0.0.1:1420',
    viewport: { width: 1380, height: 920 },
    colorScheme: 'light',
  },
  webServer: {
    command: 'pnpm dev:web',
    url: 'http://127.0.0.1:1420',
    reuseExistingServer: true,
  },
  outputDir: 'work/ui-verification-cache/results',
});
