import { test, expect } from '@playwright/test'

// Call history opens the complete deal, not just a listing link.
//
// Hugo, 2026-08-11: "The call history should be a complete snapshot when
// click: calculator of value, and the outcome of the call all in one place.
// No more flying blind after the call is made."
//
// Credentials come from env on purpose (this repo mirrors to a public one):
//
//   E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... \
//   E2E_BASE_URL=https://app.heyelsie.com npx playwright test deal-snapshot-drawer
//
// Skips cleanly when they are not set.

test.use({ storageState: { cookies: [], origins: [] } })

const EMAIL = process.env.E2E_ADMIN_EMAIL
const PASSWORD = process.env.E2E_ADMIN_PASSWORD

test.describe('the Full deal drawer on Call history', () => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_ADMIN_EMAIL / _PASSWORD not set')

  test('a property call row opens the whole deal', async ({ page }) => {
    await page.goto('/login')
    await page.locator('input[type="email"]').fill(EMAIL!)
    await page.locator('input[type="password"]').fill(PASSWORD!)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/admin|\/dashboard/, { timeout: 30_000 })

    await page.goto('/admin/crm/calls')
    await expect(page.getByText(/Call history/i).first()).toBeVisible({ timeout: 30_000 })

    // The buttons render once the batched property-links RPC resolves, a
    // beat after the table itself. Wait for the first one rather than
    // counting an empty page.
    const dealButtons = page.getByTestId('open-deal-snapshot')
    await dealButtons.first().waitFor({ timeout: 20_000 }).catch(() => {})
    const count = await dealButtons.count().catch(() => 0)
    test.skip(count === 0, 'no property calls with linked houses on this page right now')

    await dealButtons.first().click()
    const drawer = page.getByTestId('deal-snapshot-drawer')
    await expect(drawer).toBeVisible({ timeout: 15_000 })

    // The outcome of the call, always.
    await expect(drawer.getByText(/This call/i)).toBeVisible()

    // And the deal itself: either the same strip Pedro sees, or the honest
    // empty state when the auditor has since withdrawn the property.
    await expect(
      drawer.getByText(/Open at|Walk away at|No property on file/i).first(),
    ).toBeVisible({ timeout: 15_000 })
  })
})
