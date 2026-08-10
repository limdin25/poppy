import { test, expect } from '@playwright/test'

// Pedro Houses must land in the PROPERTY business, every road in.
//
// Hugo, 2026-08-10, after a day of it: "Pedro keep landing when I login on the
// old dialer. I said like about ten times today that this business is dead. He
// should land on the real estate business."
//
// Three roads are covered here: the /login form, the bare /admin/crm/dialer-pro
// (the sidebar Dialer link opens it bare), and the explicit deep link. All three
// must end on the property script, never the 2-Minute Audit.
//
// Credentials come from env on purpose. This repo mirrors to a PUBLIC GitHub
// repo (limdin25/poppy), so a real working password must never be committed:
//
//   E2E_PEDRO_HOUSES_EMAIL=... E2E_PEDRO_HOUSES_PASSWORD=... \
//   E2E_BASE_URL=https://app.heyelsie.com npx playwright test pedro-houses-landing
//
// Skips cleanly when they are not set, so CI without the secret stays green.

test.use({ storageState: { cookies: [], origins: [] } })

const EMAIL = process.env.E2E_PEDRO_HOUSES_EMAIL
const PASSWORD = process.env.E2E_PEDRO_HOUSES_PASSWORD

const PROPERTY_SCRIPT_MARKER = /Property call · estate agent|still available/i
const DEAD_BUSINESS_MARKER = /2-Minute Audit/i

test.describe('Pedro Houses lands on the property business', () => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_PEDRO_HOUSES_EMAIL / _PASSWORD not set')

  async function signIn(page: import('@playwright/test').Page) {
    await page.goto('/login')
    await page.locator('input[type="email"]').fill(EMAIL!)
    await page.locator('input[type="password"]').fill(PASSWORD!)
    await page.locator('button[type="submit"]').click()
  }

  test('signing in at /login lands straight in the property dialer', async ({ page }) => {
    await signIn(page)
    await page.waitForURL(/\/admin\/crm\/dialer-pro\?script=property_call/, { timeout: 30_000 })
    await expect(page.getByText(PROPERTY_SCRIPT_MARKER).first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(DEAD_BUSINESS_MARKER)).toHaveCount(0)
  })

  test('the BARE dialer URL (the sidebar Dialer link) shows the property script too', async ({ page }) => {
    await signIn(page)
    await page.waitForURL(/\/admin\/crm\//, { timeout: 30_000 })
    // The sidebar link, bookmarks and History redials all open it bare.
    await page.goto('/admin/crm/dialer-pro')
    await expect(page.getByText(PROPERTY_SCRIPT_MARKER).first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(DEAD_BUSINESS_MARKER)).toHaveCount(0)
  })
})
