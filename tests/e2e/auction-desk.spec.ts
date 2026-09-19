import { test, expect, type Page } from '@playwright/test'

// The Auction desk (Hugo, 2026-09-18): a Houses | Auction switch at the top of
// the CRM. On Auction the Houses board, pages and campaign are gone, the
// dialer opens the auction script, and switching back restores Houses.
//
// Runs as an ADMIN demo login, never as Pedro: switching desks writes
// profiles.active_desk, and on Pedro's real account that decides whether an
// old contact's call rings him. The test always switches back to Houses.
//
//   E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... \
//   E2E_BASE_URL=https://app.heyelsie.com npx playwright test auction-desk
//
// Credentials from env only: this repo has a public mirror.

test.use({ storageState: { cookies: [], origins: [] } })

const EMAIL = process.env.E2E_ADMIN_EMAIL
const PASSWORD = process.env.E2E_ADMIN_PASSWORD

async function signIn(page: Page) {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill(EMAIL!)
  await page.locator('input[type="password"]').fill(PASSWORD!)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 })
}

async function pickDesk(page: Page, desk: 'houses' | 'auction') {
  const tab = page.getByTestId(`desk-${desk}`)
  await expect(tab).toBeVisible({ timeout: 30_000 })
  if ((await tab.getAttribute('aria-selected')) !== 'true') {
    await tab.click()
  }
  // The whole CRM rebuilds on a switch; wait for the new one to settle.
  await expect(page.getByTestId(`desk-${desk}`)).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 })
}

test.describe('the Auction desk', () => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_ADMIN_EMAIL / _PASSWORD not set')
  test.setTimeout(180_000)

  test('switching to Auction hides Houses, shows the auction room, and switching back restores it', async ({ page }) => {
    await signIn(page)
    await page.goto('/admin/crm/pipelines')
    await pickDesk(page, 'houses')

    try {
      // HOUSES: the Houses-only pages are in the sidebar and the Houses board is shown.
      await expect(page.locator('a[href="/admin/crm/cockpit"]').first()).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText('Ballpark agreed').first()).toBeVisible({ timeout: 30_000 })

      // AUCTION.
      await pickDesk(page, 'auction')
      await expect(page.locator('a[href="/admin/crm/cockpit"]')).toHaveCount(0)
      await expect(page.locator('a[href="/admin/crm/find-builders"]')).toHaveCount(0)
      // Only the Auction board: its columns, and none of the Houses ones.
      await expect(page.getByText('Lot: figure given').first()).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText('Ballpark agreed')).toHaveCount(0)
      await expect(page.getByText('Discovery done, evaluating')).toHaveCount(0)

      // The dialer on Auction opens the auction script, whatever the URL says.
      await page.goto('/admin/crm/dialer-pro?script=property_call')
      await expect(page.getByTestId('desk-auction')).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 })
      await expect(page.getByText('Auction call · unsold lot').first()).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText(/2-Minute Audit/i)).toHaveCount(0)
      await expect(page.getByText('Property call · estate agent')).toHaveCount(0)

      // The inbox shows no Houses conversation on Auction: every thread row,
      // if any, must belong to an Auction contact. With no auction threads yet
      // the list is simply empty.
      await page.goto('/admin/crm/inbox')
      await expect(page.getByTestId('desk-auction')).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 })
      await expect(page.getByText(/JL Brickwork/i)).toHaveCount(0)
    } finally {
      // ALWAYS back to Houses, so the account is left as it was found.
      await page.goto('/admin/crm/pipelines')
      await pickDesk(page, 'houses')
    }

    // HOUSES again, exactly as before.
    await expect(page.locator('a[href="/admin/crm/cockpit"]').first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Ballpark agreed').first()).toBeVisible({ timeout: 30_000 })
  })
})
