import { test, expect } from '@playwright/test'

// The Email tab in the calling room, on production.
//
// Opened WITHOUT ?call=, on purpose: that parameter places a real call to a
// real estate agency. The room itself does not dial on load (auto-advance only
// runs after a call ends, and only with Speed on), so this is safe.
//
// It also never presses Send. Everything up to the send button is asserted,
// because the send is a real email to a real branch.
//
//   E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... \
//   E2E_BASE_URL=https://app.heyelsie.com npx playwright test property-email-tab

test.use({ storageState: { cookies: [], origins: [] } })

const EMAIL = process.env.E2E_ADMIN_EMAIL
const PASSWORD = process.env.E2E_ADMIN_PASSWORD

test.describe('the email Pedro sends while they are on the phone', () => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_ADMIN_EMAIL / _PASSWORD not set')

  test('the tab, the address field and the template are all there', async ({ page }) => {
    await page.goto('/login')
    await page.locator('input[type="email"]').fill(EMAIL!)
    await page.locator('input[type="password"]').fill(PASSWORD!)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/admin|\/dashboard/, { timeout: 30_000 })

    // The property room. No ?call=, so nothing is dialled.
    await page.goto('/admin/crm/dialer-pro?script=property_call')

    const emailTab = page.getByRole('button', { name: /^Email$/ })
    await emailTab.waitFor({ timeout: 30_000 })
    await emailTab.click()

    const pane = page.getByTestId('property-email-pane')
    await expect(pane).toBeVisible({ timeout: 15_000 })

    // The field that did not exist before. It is empty and typeable, and it is
    // what the brain fills when the branch says the address out loud.
    const address = page.getByTestId('property-email-address')
    await expect(address).toBeVisible()

    // The template Pedro asked for is ALREADY in the box, not behind a picker.
    const body = page.getByTestId('property-email-body')
    await expect(body).toContainText('video walkthrough')
    await expect(body).toContainText('Unico')
    // Call one never puts a figure in writing.
    await expect(body).not.toContainText('£')

    // Send is dead until there is an address AND a lead on screen. Never
    // actually pressed, in any state: that is a real email to a real branch.
    const send = page.getByTestId('property-email-send')
    await expect(send).toBeDisabled()
    await address.fill('doug@ddmresidential.co.uk')
    await expect(address).toHaveValue('doug@ddmresidential.co.uk')
  })

  test('the plumber room does not grow an Email tab', async ({ page }) => {
    // Marr rings 200 plumbers a day on this screen. The tab set must not move.
    await page.goto('/login')
    await page.locator('input[type="email"]').fill(EMAIL!)
    await page.locator('input[type="password"]').fill(PASSWORD!)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/admin|\/dashboard/, { timeout: 30_000 })

    await page.goto('/admin/crm/dialer-pro')
    await page.getByRole('button', { name: /^Calculator$/ }).waitFor({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: /^Email$/ })).toHaveCount(0)
  })
})
