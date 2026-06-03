import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright e2e config.
 *
 * e2e specs live under tests/e2e/ (kept apart from the vitest *.test.ts files in
 * tests/, which run under node via vitest). Run against any deployment by setting
 * E2E_BASE_URL — otherwise it spins up the local dev server on :5174.
 *
 *   E2E_BASE_URL=https://elsie-preview.vercel.app npx playwright test
 *   npx playwright test            # local dev server
 */
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5174'
const useLocalServer = !process.env.E2E_BASE_URL

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'playwright-report/results.json' }],
  ],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 12_000,
  },
  projects: [
    // Logs in once and writes tests/e2e/.auth/user.json (reused by the rest).
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: 'tests/e2e/.auth/user.json' },
      dependencies: ['setup'],
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], storageState: 'tests/e2e/.auth/user.json' },
      dependencies: ['setup'],
    },
  ],
  ...(useLocalServer
    ? {
        webServer: {
          command: 'npm run dev',
          port: 5174,
          reuseExistingServer: true,
          timeout: 60_000,
        },
      }
    : {}),
})
