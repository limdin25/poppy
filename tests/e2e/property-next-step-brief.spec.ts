import { test, expect } from '@playwright/test'

// The next-step brief and Hugo's pinned note, on production, end to end.
//
// This is the one chain that cannot be proven by a unit test: a new column, a
// re-created SECURITY DEFINER RPC, the admin API projection, and the shared
// card that Pedro, Call history and the admin drawer all render. Any one of
// those four silently dropping the field looks exactly like "no note yet".
//
// Driven through /admin/properties rather than the dialer, because the only
// deep link into the dialer places a real call to a real estate agent.
//
// Credentials come from env (this repo mirrors to a public one):
//
//   E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... \
//   E2E_BASE_URL=https://app.heyelsie.com npx playwright test property-next-step-brief

test.use({ storageState: { cookies: [], origins: [] } })

const EMAIL = process.env.E2E_ADMIN_EMAIL
const PASSWORD = process.env.E2E_ADMIN_PASSWORD

test.describe('the next-step brief reaches the screen', () => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_ADMIN_EMAIL / _PASSWORD not set')

  test('Hugo\'s pinned note shows on the house he pinned it to', async ({ page }) => {
    await page.goto('/login')
    await page.locator('input[type="email"]').fill(EMAIL!)
    await page.locator('input[type="password"]').fill(PASSWORD!)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/admin|\/dashboard/, { timeout: 30_000 })

    await page.goto('/admin/properties')
    // Welwyn Park Road carries a pinned note written on 2026-08-14. If the
    // property is ever pruned this skips rather than failing red for a reason
    // that has nothing to do with the code.
    const row = page.getByText(/Welwyn Park Road/i).first()
    // waitFor, never isVisible(): isVisible returns instantly, so on a page
    // that is still fetching it answers false and the test skips itself green.
    await row.waitFor({ timeout: 25_000 }).catch(() => {})
    test.skip(await row.count() === 0, 'Welwyn Park Road is no longer on the board')
    await row.click()

    const card = page.getByTestId('next-step-card')
    await expect(card).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('next-step-pinned')).toContainText('proof of funds')
    await expect(page.getByTestId('next-step-pinned')).toContainText('From Hugo')

    // And the editor is there, seeded with what is actually pinned, so the
    // next note does not need a developer.
    const box = page.locator('textarea').filter({ hasText: /KEEP: Zest Hull/ }).first()
    await expect(box).toBeVisible()
  })
})
