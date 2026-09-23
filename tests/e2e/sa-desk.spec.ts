import { test, expect, type Page } from '@playwright/test'

// The Serviced Accommodation desk (Hugo, 2026-09-23): the third option in the
// desk drop down. On it the Houses and Auction boards, pages and campaigns are
// gone, the dialer opens the SA room (the flat, the SA script, Coach, Email,
// Messages), and switching back restores Houses.
//
// Runs as an ADMIN demo login, never as Pedro: switching desks writes
// profiles.active_desk, and on Pedro's real account that decides whether an
// old contact's call rings him. The test always switches back to Houses.
// Nothing is pressed that saves an outcome or sends an email.
//
//   E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... \
//   E2E_BASE_URL=https://app.heyelsie.com npx playwright test sa-desk --project=chromium --no-deps
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

async function pickDesk(page: Page, desk: 'houses' | 'auction' | 'sa') {
  const select = page.getByTestId('desk-select')
  await expect(select).toBeVisible({ timeout: 30_000 })
  if ((await select.inputValue()) !== desk) {
    await select.selectOption(desk)
  }
  await expect(page.getByTestId('desk-select')).toHaveValue(desk, { timeout: 30_000 })
}

test.describe('the Serviced Accommodation desk', () => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_ADMIN_EMAIL / _PASSWORD not set')
  test.setTimeout(180_000)

  test('the drop down opens a clean SA desk with the flat, the SA script and the email, and goes back to Houses', async ({ page }) => {
    await signIn(page)
    await page.goto('/admin/crm/pipelines')
    await pickDesk(page, 'houses')

    try {
      // The drop down offers all three desks.
      const options = await page.getByTestId('desk-select').locator('option').allTextContents()
      expect(options).toEqual(['Houses', 'Auction', 'Serviced Accommodation'])

      // SERVICED ACCOMMODATION: only its own board, no Houses-only pages.
      await pickDesk(page, 'sa')
      await expect(page.locator('a[href="/admin/crm/cockpit"]')).toHaveCount(0)
      await expect(page.locator('a[href="/admin/crm/find-builders"]')).toHaveCount(0)
      await expect(page.getByText('SA: yes in principle').first()).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText('Ballpark agreed')).toHaveCount(0)
      await expect(page.getByText('Lot: figure given')).toHaveCount(0)

      // The dialer on SA opens the SA script, whatever the URL says.
      await page.goto('/admin/crm/dialer-pro?script=property_call')
      await expect(page.getByTestId('desk-select')).toHaveValue('sa', { timeout: 30_000 })
      await expect(page.getByText('Serviced accommodation · letting agent').first()).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText('Property call · estate agent')).toHaveCount(0)
      await expect(page.getByText('Auction call · unsold lot')).toHaveCount(0)
      await expect(page.getByText(/2-Minute Audit/i)).toHaveCount(0)

      // With agencies in the queue, the Flat tab shows a real flat and the
      // outcome buttons, and the script is filled from it.
      const flat = page.getByTestId('sa-listing-pane')
      const hasFlat = await flat.waitFor({ state: 'visible', timeout: 30_000 }).then(() => true, () => false)
      if (!hasFlat) {
        await expect(page.getByText('No letting agent on the line')).toBeVisible()
      } else {
        await expect(page.getByTestId('sa-listing-detail')).toContainText('a month')
        await expect(page.getByTestId('sa-outcome-yes_in_principle')).toBeVisible()
        await expect(page.getByTestId('sa-outcome-no_company_lets')).toBeVisible()
        const script = page.frameLocator('iframe').first()
        await expect(script.getByText(/We are the middleman\. We do not take the flat\./).first()).toBeVisible({ timeout: 20_000 })
        await expect(script.getByText(/I'm calling about the \d bed/).first()).toBeVisible({ timeout: 20_000 })
        await expect(script.getByText('[sa_street]')).toHaveCount(0)
        await expect(page.getByTestId('sa-listing-detail')).not.toContainText('T00:00:00')

        // The Email tab carries the company-let email, ready for Pedro to send.
        // The floating dialer card can sit over the tabs (Pedro drags it where
        // he likes), so press the tab directly rather than at a screen point.
        await page.getByRole('button', { name: 'Email', exact: true }).last().dispatchEvent('click')
        await expect(page.getByTestId('sa-email-pane')).toBeVisible()
        await expect(page.getByTestId('sa-email-body')).toHaveValue(/we work with serviced accommodation companies/)
        await expect(page.getByTestId('sa-email-send')).toBeDisabled()
      }

      // The inbox shows no Houses conversation on SA.
      await page.goto('/admin/crm/inbox')
      await expect(page.getByTestId('desk-select')).toHaveValue('sa', { timeout: 30_000 })
      await expect(page.getByText(/JL Brickwork/i)).toHaveCount(0)
    } finally {
      // ALWAYS back to Houses, so the account is left as it was found.
      await page.goto('/admin/crm/pipelines')
      await pickDesk(page, 'houses')
    }

    await expect(page.locator('a[href="/admin/crm/cockpit"]').first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Ballpark agreed').first()).toBeVisible({ timeout: 30_000 })
  })
})
