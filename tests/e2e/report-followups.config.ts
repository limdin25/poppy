import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  testDir: '.', testMatch: 'report-followups.spec.ts', workers: 1,
  use: { baseURL: 'http://localhost:5176', channel: process.env.PW_BROWSER_CHANNEL, viewport: { width: 1366, height: 768 }, timezoneId: 'Asia/Manila' },
  webServer: { cwd: fileURLToPath(new URL('../../', import.meta.url)), command: 'VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=test node_modules/.bin/vite --port 5176 --host 127.0.0.1', url: 'http://localhost:5176', reuseExistingServer: true },
});
