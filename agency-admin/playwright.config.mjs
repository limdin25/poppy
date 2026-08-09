// Standalone Playwright config for the Agency Admin UI mock.
// Run with: npx playwright test -c agency-admin/playwright.config.mjs
// Fully separate from the main app's playwright.config.ts (tests/e2e).
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.mjs',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4621',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'python3 -m http.server 4621 --directory .',
    port: 4621,
    reuseExistingServer: true,
  },
})
