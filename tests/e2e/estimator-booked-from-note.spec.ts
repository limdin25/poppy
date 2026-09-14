import { test, expect } from '@playwright/test'

// A viewing Pedro wrote in a note reaches the refurb estimator.
//
// Pedro, 2026-09-14, the fifth time: "two of the properties that I booked for an
// viewing last week is not showing up on refurb estimator section."
//
//   27 Dewhurst Ave, Blackpool       note only, Voicemail pressed
//   Delfryn, Padeswood Rd N, Buckley note only, no outcome, no house on file
//
// Opening the estimator runs the shared viewing list, which now reads booking
// notes first (api/lib/booking-from-note.ts). Both houses must be in the
// dropdown. Against the real thing:
//
//   E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... \
//   E2E_BASE_URL=https://app.heyelsie.com npx playwright test estimator-booked-from-note
//
// Skips cleanly when the credentials are not set.

test.use({ storageState: { cookies: [], origins: [] } })

const EMAIL = process.env.E2E_ADMIN_EMAIL
const PASSWORD = process.env.E2E_ADMIN_PASSWORD

test.describe('bookings written in a note', () => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_ADMIN_EMAIL / _PASSWORD not set')

  test('Dewhurst Avenue and Padeswood Road North are in the estimator dropdown', async ({ page }) => {
    await page.goto('/login')
    await page.locator('input[type="email"]').fill(EMAIL!)
    await page.locator('input[type="password"]').fill(PASSWORD!)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/admin|\/dashboard/, { timeout: 30_000 })

    await page.goto('/admin/crm/estimator')
    const picker = page.getByTestId('estimator-property')
    await expect(picker).toBeVisible({ timeout: 30_000 })

    const options = picker.locator('option')
    await expect.poll(async () => (await options.allTextContents()).join(' | '), { timeout: 60_000 })
      .toMatch(/Dewhurst Avenue/i)
    const all = (await options.allTextContents()).join(' | ')
    expect(all).toMatch(/Padeswood Road North/i)
  })
})
