import { test, expect } from '@playwright/test'

// A branch whose only deal the auditor withdrew must still show its deal in
// Call history.
//
// Hugo, 2026-08-11, looking at the Dixons row: "why cant i see full deal for
// Dixons, havent you fixed it". He was right. The purge had DELETED Holloway
// Head, Dixons' only listing, so the chip and the button both vanished and
// thirteen calls had nothing behind them. Killed deals are now filed as
// 'auditor_killed' instead: hidden from the dialer, shown here, labelled.
//
//   E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... \
//   E2E_BASE_URL=https://app.heyelsie.com npx playwright test deal-withdrawn-visible

test.use({ storageState: { cookies: [], origins: [] } })

const EMAIL = process.env.E2E_ADMIN_EMAIL
const PASSWORD = process.env.E2E_ADMIN_PASSWORD

test.describe('a withdrawn deal is still readable after the call', () => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_ADMIN_EMAIL / _PASSWORD not set')

  test('Dixons opens its withdrawn Holloway Head deal, with the reasons', async ({ page }) => {
    await page.goto('/login')
    await page.locator('input[type="email"]').fill(EMAIL!)
    await page.locator('input[type="password"]').fill(PASSWORD!)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/admin|\/dashboard/, { timeout: 30_000 })

    await page.goto('/admin/crm/calls?q=Dixons')
    await expect(page.getByText(/Call history/i).first()).toBeVisible({ timeout: 30_000 })

    const dealButtons = page.getByTestId('open-deal-snapshot')
    await dealButtons.first().waitFor({ timeout: 20_000 })
    await dealButtons.first().click()

    const drawer = page.getByTestId('deal-snapshot-drawer')
    await expect(drawer).toBeVisible({ timeout: 15_000 })
    await expect(drawer.getByText(/Holloway Head/i).first()).toBeVisible({ timeout: 15_000 })

    // Labelled as withdrawn, with the auditor's own explanation.
    const banner = drawer.getByTestId('deal-withdrawn')
    await expect(banner).toBeVisible()
    await expect(banner.getByText(/wrong class of building|asking price/i).first()).toBeVisible()

    // The numbers it was called about are still there, and are the fixed ones:
    // never the 95,000 opener that started all this.
    await expect(drawer.getByText(/Open at/i).first()).toBeVisible()
    await expect(drawer.getByText('£95,000')).toHaveCount(0)
  })
})
