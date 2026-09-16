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

    // Pick the first house if any are listed. The list arrives async, so wait
    // for it: reading the count straight away returned 0 and skipped the test
    // on a screen that had 51 houses on it.
    await page.getByTestId('builder-property-row').first()
      .waitFor({ state: 'visible', timeout: 25_000 }).catch(() => {})
    const first = page.getByTestId('builder-property-row').first()
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

  // Pedro, 2026-09-16: "I called this builder now and he said I've called him 4
  // times already for a different property but there is no indication in the
  // disposition that they are not interested or charging to view". A builder
  // rung about ANY other house now says so on the row he dials from.
  test('a builder rung about another house says so on the row', async ({ authedPage: page }) => {
    await page.goto('/admin/crm/find-builders')
    await expect(page.getByTestId('find-builders-page')).toBeVisible({ timeout: 20_000 })

    await page.getByTestId('builder-property-row').first()
      .waitFor({ state: 'visible', timeout: 25_000 }).catch(() => {})
    const houses = page.getByTestId('builder-property-row')
    const count = await houses.count()
    test.skip(count === 0, 'no viewing-booked house on this account right now')

    // Data dependent by nature: the line only exists once somebody has rung a
    // builder about a DIFFERENT house, so walk a few houses looking for one.
    let found = false
    for (let i = 0; i < Math.min(count, 6) && !found; i++) {
      await houses.nth(i).click()
      // A house with no builders yet shows neither a row nor a scrape button,
      // so this waits rather than asserting: the next house is the answer.
      await page.getByTestId('builder-row').first()
        .waitFor({ state: 'visible', timeout: 12_000 }).catch(() => {})
      found = (await page.getByTestId('builder-history').count()) > 0
    }
    test.skip(!found, 'no builder on these houses has been rung about another one')

    const chip = page.getByTestId('builder-history').first()
    await expect(chip).toBeVisible()
    await expect(chip).toHaveText(/Rung (once|\d+ times) before/)
  })
})
