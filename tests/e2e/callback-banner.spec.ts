import { test, expect } from '@playwright/test'

// The top stripe that says who came back to us.
//
// Hugo, 2026-08-26: "if someone calls us back it should show on the top, the
// top stripe that we have on the app... so he can click and go to the inbox."
// And then: "make visible always."
//
// ALWAYS VISIBLE is the part a unit test cannot prove, because it is a claim
// about the running app rather than about a function. So this signs in for
// real and asserts the strip is on screen on more than one CRM page.
//
// Credentials from env: this repo mirrors to a PUBLIC GitHub repo, so a working
// password is never committed. Skips cleanly when they are absent.
//
//   E2E_OWNER_EMAIL=... E2E_OWNER_PASSWORD=... \
//   E2E_BASE_URL=https://app.heyelsie.com npx playwright test callback-banner

test.use({ storageState: { cookies: [], origins: [] } })

const EMAIL = process.env.E2E_OWNER_EMAIL
const PASSWORD = process.env.E2E_OWNER_PASSWORD

test.describe('the callback banner', () => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_OWNER_EMAIL / _PASSWORD not set')

  async function signIn(page: import('@playwright/test').Page) {
    await page.goto('/login')
    await page.locator('input[type="email"]').fill(EMAIL!)
    await page.locator('input[type="password"]').fill(PASSWORD!)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/admin/, { timeout: 30_000 })
  }

  /** "Checking" is the pre-answer state. Waiting it out is the difference
   *  between proving the strip works and proving it renders. */
  async function settled(page: import('@playwright/test').Page) {
    const banner = page.getByTestId('callback-banner')
    await expect(banner).toBeVisible({ timeout: 20_000 })
    await expect(banner).not.toContainText('Checking', { timeout: 20_000 })
    return banner
  }

  test('is on screen on every CRM page, and says something either way', async ({ page }) => {
    await signIn(page)

    for (const path of ['/admin/crm/inbox', '/admin/crm/contacts']) {
      await page.goto(path)
      const banner = await settled(page)
      // Never blank: either a count of people, or the calm state.
      await expect(banner).toHaveText(/missed call|came back to us|Nothing to call back/i)
    }
  })

  test('lists who came back and clicks through to their conversation', async ({ page }) => {
    await signIn(page)
    await page.goto('/admin/crm/inbox')
    await settled(page)

    const toggle = page.getByTestId('callback-banner-toggle')
    // Nobody waiting is a legitimate state and must not fail the run.
    if ((await toggle.count()) === 0) {
      test.info().annotations.push({ type: 'note', description: 'nobody waiting on us right now' })
      return
    }

    await toggle.click()
    const rows = page.getByTestId('callback-row')
    await expect(rows.first()).toBeVisible()

    await rows.first().locator('button').first().click()
    await expect(page).toHaveURL(/\/admin\/crm\/inbox\?contact=[0-9a-f-]{36}/)
  })
})
