import { test as base, expect, type Page } from '@playwright/test'
import { heal, existsHealed } from './healer'

/**
 * Shared auth helpers + an `authedPage` fixture.
 *
 * Uses the seeded demo account (one-tap demo logins on /login). Override via env
 * for a dedicated QA account:
 *   E2E_EMAIL=test-owner@heyelsie-qa.com E2E_PASSWORD=... npx playwright test
 */
export const DEMO_EMAIL = process.env.E2E_EMAIL || 'demo.user@heyelsie.com'
export const DEMO_PASSWORD = process.env.E2E_PASSWORD || 'demo1234'

/** Log in via the email/password form and wait until the app shell renders. */
export async function login(page: Page, email = DEMO_EMAIL, password = DEMO_PASSWORD): Promise<void> {
  await page.goto('/login')
  await (await heal(page, { placeholder: /you@|email/i, role: { type: 'textbox', name: /email/i }, css: 'input[type="email"]', describe: 'email field' })).fill(email)
  await (await heal(page, { placeholder: /•|password/i, css: 'input[type="password"]', describe: 'password field' })).fill(password)
  await (await heal(page, { role: { type: 'button', name: /log ?in|sign ?in|continue/i }, css: 'button[type="submit"]', describe: 'login submit' })).click()
  // Land on the authenticated shell at /dashboard. The Inbox link lives in the
  // desktop sidebar OR the mobile bottom nav — assert whichever is *visible*.
  await page.waitForURL(/\/dashboard|\/inbox|\/leads/, { timeout: 20_000 }).catch(() => {})
  await expect(page.locator('a[href*="inbox"]:visible').first()).toBeVisible({ timeout: 15_000 })
}

/** Log out via the sidebar/account menu if a sign-out control is reachable. */
export async function logout(page: Page): Promise<void> {
  if (await existsHealed(page, { role: { type: 'button', name: /sign out|log ?out/i }, text: /sign out|log ?out/i })) {
    await (await heal(page, { role: { type: 'button', name: /sign out|log ?out/i }, text: /sign out|log ?out/i })).click()
  }
}

export const test = base.extend<{ authedPage: Page }>({
  // Auth comes from the saved storageState (see auth.setup.ts) — no per-test login.
  // The fixture just lands on the app shell so each test starts from a known place.
  authedPage: async ({ page }, use) => {
    await page.goto('/dashboard')
    // Desktop sidebar or mobile bottom nav — assert whichever Inbox link is visible.
    await expect(page.locator('a[href*="inbox"]:visible').first()).toBeVisible({ timeout: 15_000 })
    await use(page)
  },
})

export { expect }
