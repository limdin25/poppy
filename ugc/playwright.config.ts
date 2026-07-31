import { defineConfig, devices } from '@playwright/test';

// Every spec runs against the deterministic mock backend: zero spend, no
// network, same results every run. The same suite points at a preview deploy
// in step 12 by swapping E2E_BASE_URL.
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  fullyParallel: true,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5175',
    trace: 'retain-on-failure',
  },
  ...(process.env.E2E_BASE_URL
    ? {}
    : {
        webServer: {
          command: 'npm run dev',
          port: 5175,
          reuseExistingServer: true,
          env: { VITE_UGC_API_MODE: 'mock' },
        },
      }),
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: '**/mobile-review.spec.ts',
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      testMatch: '**/mobile-review.spec.ts',
    },
  ],
});
