import { test, expect } from './helpers/auth'

/**
 * Find builders: forever dispositions and a missing-postcode heal.
 *
 * Pedro, 2026-09-10: builders who said no on another house kept reappearing,
 * and Fartown had no postcode so the list was empty. This proves the screen
 * exposes the forever outcomes and a postcode box when the house has none.
 */
test.describe('Find builders forever flags and postcode', () => {
  test.skip(process.env.E2E_OWNER_READY !== '1' && process.env.E2E_PEDRO_READY !== '1',
    'needs a CRM agent login')

  test('outcome dropdown names the forever flags', async ({ authedPage: page }) => {
    await page.goto('/admin/crm/estimator')
    // Estimator is a sibling desk; Find builders is the one we care about.
    await page.goto('/admin/crm/find-builders')
    await expect(page.getByTestId('find-builders-page')).toBeVisible({ timeout: 20_000 })

    // Pick the first house if any are listed.
    const first = page.locator('[data-testid="property-picker-row"]').first()
    if (await first.count() === 0) {
      test.skip(true, 'no viewing-booked house on this account right now')
      return
    }
    await first.click()

    // If the house already has builders, open an outcome select and prove the
    // forever labels exist. If not, prove the postcode or find button is on face.
    const outcome = page.getByTestId('builder-outcome').first()
    if (await outcome.count()) {
      const html = await outcome.innerHTML()
      expect(html).toMatch(/Not interested, any house/)
      expect(html).toMatch(/Charges to view/)
      expect(html).toMatch(/Not interested \(this house\)/)
    } else {
      // Empty roster: either searching, or asking for a postcode.
      const noPc = page.getByTestId('find-builders-no-outcode')
      const scrape = page.getByTestId('find-builders-scrape')
      await expect(noPc.or(scrape)).toBeVisible({ timeout: 15_000 })
      if (await noPc.count()) {
        await expect(page.getByTestId('find-builders-set-postcode')).toBeVisible()
      }
    }
  })
})
