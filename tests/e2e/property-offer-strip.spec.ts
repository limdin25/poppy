import { test, expect, type Page } from '@playwright/test'

// The strip above Pedro's script, in BOTH the states it will actually be in.
//
// Stage 7 added three things to it: which deal this is (BRRR, flip, HMO), how
// far below market it is as a band so he knows how hard to push, and one line
// of why. All three come from the deal engine, and the engine that fills them
// is still being wired up, so today every property arrives without them.
//
// So there are two states and both have to be right:
//
//   1. NOTHING JUDGED, which is every property right now. The strip must look
//      exactly as it did: no empty box, no placeholder dash, no "undefined"
//      sitting where a grade should be.
//   2. JUDGED, which is what it looks like once the engine ships. The three
//      fields are injected into the REAL RPC response here, rather than into a
//      fabricated one, so the test proves the strip reads them out of the same
//      deal blob shape the scraper actually sends.
//
// Driven through Call history rather than the dialer, on purpose: the only
// deep link into the dialer is ?call=, which places a real phone call to a real
// estate agent. The drawer renders the identical OfferStrip component.
//
// Credentials come from env (this repo mirrors to a public one):
//
//   E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... \
//   E2E_BASE_URL=https://app.heyelsie.com npx playwright test property-offer-strip

test.use({ storageState: { cookies: [], origins: [] } })

const EMAIL = process.env.E2E_ADMIN_EMAIL
const PASSWORD = process.env.E2E_ADMIN_PASSWORD

const BAND_WORDS = /THIN DEAL|MEETS CRITERIA|STRONG DEAL/

async function signIn(page: Page) {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill(EMAIL!)
  await page.locator('input[type="password"]').fill(PASSWORD!)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(/\/admin|\/dashboard/, { timeout: 30_000 })
}

/** Open the first property call's full deal. Skips when today's page has none. */
async function openFirstDeal(page: Page) {
  await page.goto('/admin/crm/calls')
  await expect(page.getByText(/Call history/i).first()).toBeVisible({ timeout: 30_000 })
  const buttons = page.getByTestId('open-deal-snapshot')
  await buttons.first().waitFor({ timeout: 20_000 }).catch(() => {})
  const count = await buttons.count().catch(() => 0)
  test.skip(count === 0, 'no property calls with linked houses on this page right now')
  await buttons.first().click()
  const drawer = page.getByTestId('deal-snapshot-drawer')
  await expect(drawer).toBeVisible({ timeout: 15_000 })
  return drawer
}

test.describe('the offer strip, judged and unjudged', () => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_ADMIN_EMAIL / _PASSWORD not set')

  test('UNJUDGED: the strip is exactly as it was, with nothing invented', async ({ page }) => {
    await signIn(page)
    const drawer = await openFirstDeal(page)

    // The money is still there, or the honest empty state is.
    await expect(
      drawer.getByText(/Open at|Walk away at|No offer band for this one|No property on file/i).first(),
    ).toBeVisible({ timeout: 15_000 })

    // And not one of the three new things, because nothing has judged this
    // property. A band on an ungraded house is the failure this whole strip is
    // designed against: it would read as a grade and Pedro would push on it.
    await expect(drawer.getByText(BAND_WORDS)).toHaveCount(0)

    // No placeholder anywhere. "undefined" or a stray NaN under the figures is
    // how a missing field turns into a fact on a live call. Whole words only:
    // the first version of this check failed on the word "refinance".
    const body = await drawer.innerText()
    expect(body).not.toMatch(/\bundefined\b/i)
    expect(body).not.toMatch(/\[object Object\]/i)
    expect(body).not.toMatch(/\bNaN\b/)
  })

  test('JUDGED: strategy, band and reason all render', async ({ page }) => {
    await signIn(page)

    // The real response, with the three fields the new engine will add. Also
    // forced to a live status, because roughly half the board is withdrawn and
    // a withdrawn deal deliberately wears none of this.
    await page.route('**/rpc/wk_property_agent_listings*', async (route) => {
      const res = await route.fetch()
      let rows: unknown
      try { rows = await res.json() } catch { await route.fulfill({ response: res }); return }
      const patched = (Array.isArray(rows) ? rows : []).map((r) => {
        const row = r as Record<string, unknown>
        return {
          ...row,
          status: 'new',
          deal: {
            ...((row.deal as Record<string, unknown>) ?? {}),
            strategy: 'brrr',
            bmv_band: 'thin',
            condition_band: 'full_refurb',
          },
        }
      })
      await route.fulfill({ response: res, json: patched })
    })

    const drawer = await openFirstDeal(page)

    await expect(drawer.getByText('BRRR', { exact: true }).first()).toBeVisible({ timeout: 15_000 })
    await expect(drawer.getByText('THIN DEAL', { exact: true }).first()).toBeVisible()
    // The band is only worth showing if it tells him what to DO with it.
    await expect(drawer.getByText(/Hold near the opener/i).first()).toBeVisible()
    // One line of why, built from the condition read.
    await expect(drawer.getByText(/needs a full refurb/i).first()).toBeVisible()

    // The ceiling warning is still the loudest thing on the strip. Adding three
    // chips above it must not have buried it.
    await expect(drawer.getByText('NEVER SAY THIS OUT LOUD').first()).toBeVisible()
  })
})
