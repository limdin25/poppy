import { test as setup } from '@playwright/test'
import { login } from './helpers/auth'
import fs from 'fs'

/**
 * One-time auth. Logs in once and saves the session (Supabase token lives in
 * localStorage) to storageState, which every spec reuses — so a full run does ONE
 * login instead of 158, avoiding auth rate-limiting under parallel load.
 * Path is cwd-relative (project root) to match playwright.config storageState.
 */
const authDir = 'tests/e2e/.auth'
const authFile = `${authDir}/user.json`

setup('authenticate', async ({ page }) => {
  await login(page)
  fs.mkdirSync(authDir, { recursive: true })
  await page.context().storageState({ path: authFile })
})
