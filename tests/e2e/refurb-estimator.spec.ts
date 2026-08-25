import { test, expect } from './helpers/auth'

/**
 * The refurb estimator: talk through the Rightmove photos, get our costs and a
 * message for the builder.
 *
 * Hugo, 2026-08-25: "He's gonna be on the computer recording and then he's
 * gonna be looking at Rightmove, the photos ... this page gonna take the text
 * he's saying and then it's gonna spit out the message for the builder and our
 * version of the costs."
 *
 * WHAT IS ACTUALLY WORTH ASSERTING HERE. The arithmetic is covered exhaustively
 * in tests/refurb-estimator.test.ts, which runs in milliseconds and does not
 * need a browser or a model. So this file only proves the things a unit test
 * cannot: that the URL Hugo circulated resolves at all, that the page renders,
 * and that a real generate press comes back with a priced list and a builder
 * message rather than an error.
 *
 * Needs a CRM login (E2E_OWNER_READY=1 + E2E_EMAIL/E2E_PASSWORD). The generate
 * test also spends a real model call, so it is kept to one.
 */
test.describe('Refurb estimator', () => {
  test.skip(process.env.E2E_OWNER_READY !== '1', 'needs a CRM account (E2E_OWNER_READY=1)')

  test('opens on both the tidy URL and the one Hugo sent round', async ({ authedPage: page }) => {
    // /admin/crm/estimator is where it belongs.
    await page.goto('/admin/crm/estimator')
    await expect(page.getByTestId('estimator-transcript')).toBeVisible({ timeout: 20000 })

    // /admin/crm/inbox/estimator is the link Hugo actually sent. `inbox` has no
    // child routes, so without an explicit route this falls through the CRM
    // catch-all and lands silently on the inbox, which looks like the feature
    // was never built. That is the regression this assertion exists to catch.
    await page.goto('/admin/crm/inbox/estimator')
    await expect(page.getByTestId('estimator-transcript')).toBeVisible({ timeout: 20000 })
  })

  test('will not let him press generate with nothing to read', async ({ authedPage: page }) => {
    await page.goto('/admin/crm/estimator')
    await expect(page.getByTestId('estimator-generate')).toBeDisabled()
    await page.getByTestId('estimator-transcript').fill('Kitchen is old.')
    // Still too short to price honestly.
    await expect(page.getByTestId('estimator-generate')).toBeDisabled()
  })

  test('reads a real walkthrough and gives back costs and a builder message', async ({ authedPage: page }) => {
    test.setTimeout(120_000)
    await page.goto('/admin/crm/estimator')

    await page.getByTestId('estimator-address').fill('14 Oundle Road, Birmingham B44')
    await page.getByTestId('estimator-sqm').fill('88')
    // The built-in example is a real walkthrough of a real kind of house, so it
    // is the honest input to test with rather than a contrived one.
    await page.getByTestId('load-example').click()
    await expect(page.getByTestId('estimator-generate')).toBeEnabled()

    await page.getByTestId('estimator-generate').click()

    // The model call runs up to 60 seconds.
    await expect(page.getByTestId('estimate-totals')).toBeVisible({ timeout: 90_000 })

    // A real figure in pounds, not a zero and not a blank.
    const budget = await page.getByTestId('estimate-budget').innerText()
    expect(budget).toMatch(/^£[\d,]+$/)
    expect(Number(budget.replace(/[£,]/g, ''))).toBeGreaterThan(1000)

    // Priced lines, and the kitchen is one of them: the example says in as many
    // words that the kitchen gets ripped out.
    await expect(page.getByTestId('estimate-lines').locator('tr')).not.toHaveCount(0)
    await expect(page.getByTestId('estimate-lines')).toContainText(/kitchen/i)

    // The builder's message exists, names the house and asks for itemised pricing.
    const brief = await page.getByTestId('builder-brief').innerText()
    expect(brief).toContain('14 Oundle Road')
    expect(brief).toContain('item by item')

    // The anchor switch is on by default, so our budget is on the message, and
    // turning it off takes every pound sign away.
    expect(brief).toContain('£')
    await page.getByTestId('anchor-toggle').uncheck()
    await expect(page.getByTestId('builder-brief')).not.toContainText('£')
  })
})
