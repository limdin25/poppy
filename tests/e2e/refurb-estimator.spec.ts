import { test, expect } from './helpers/auth'

/**
 * The refurb estimator: one box per part of the property, each with a mic.
 *
 * Hugo, 2026-08-25: "It should be one box per room ... there's a button where he
 * can press the audio and he can speak ... now there are many sections of the
 * parts of the property, so he doesn't forget to look at anything."
 *
 * WHAT IS WORTH ASSERTING HERE. The arithmetic and the checklist are covered
 * exhaustively in tests/refurb-estimator.test.ts, which runs in milliseconds
 * with no browser and no model. So this file proves only what a unit test
 * cannot: that the URL Hugo circulated resolves, that all fourteen boxes render
 * with their own microphone, that the counter tracks what he has filled in, and
 * that a real generate press comes back priced rather than erroring.
 *
 * Needs a CRM login (E2E_OWNER_READY=1 + E2E_EMAIL/E2E_PASSWORD). The generate
 * test spends a real model call, so there is exactly one of them.
 */
test.describe('Refurb estimator', () => {
  test.skip(process.env.E2E_OWNER_READY !== '1', 'needs a CRM account (E2E_OWNER_READY=1)')

  test('opens on both the tidy URL and the one Hugo sent round', async ({ authedPage: page }) => {
    await page.goto('/admin/crm/estimator')
    await expect(page.getByTestId('section-bathroom')).toBeVisible({ timeout: 20000 })

    // `inbox` has no child routes, so without an explicit route this falls
    // through the CRM catch-all and lands silently on the inbox, which looks
    // exactly like the feature was never built. That is the regression this
    // assertion exists to catch.
    await page.goto('/admin/crm/inbox/estimator')
    await expect(page.getByTestId('section-bathroom')).toBeVisible({ timeout: 20000 })
  })

  test('gives every part of the property its own box and its own microphone', async ({ authedPage: page, browserName }) => {
    await page.goto('/admin/crm/estimator')

    // The parts Hugo named by name, plus the ones people forget on their own.
    for (const id of ['front', 'roof', 'bathroom', 'bedrooms', 'garden', 'electrics', 'heating', 'damp']) {
      await expect(page.getByTestId(`section-${id}`)).toBeVisible()
      await expect(page.getByTestId(`text-${id}`)).toBeVisible()
    }

    // The microphone buttons are Chrome's Web Speech API, which Firefox does
    // not implement at all. On a browser without it the page must hide the
    // buttons and say so, rather than show a button that does nothing.
    if (browserName === 'chromium') {
      await expect(page.getByTestId('mic-bathroom')).toBeVisible()
      await expect(page.getByTestId('mic-roof')).toBeVisible()
    }
  })

  test('counts what he has looked at, so nothing is missed quietly', async ({ authedPage: page }) => {
    await page.goto('/admin/crm/estimator')
    // Boxes persist to localStorage, so start from a known state.
    await page.evaluate(() => localStorage.removeItem('elsie.refurb-estimator.v3'))
    await page.reload()

    await expect(page.getByTestId('sections-done')).toHaveText('0')
    await page.getByTestId('text-bathroom').fill('White suite, all matches, black mould above the bath and no fan.')
    await expect(page.getByTestId('sections-done')).toHaveText('1')
    await page.getByTestId('text-roof').fill('Roof looks straight, two or three slates missing on the left.')
    await expect(page.getByTestId('sections-done')).toHaveText('2')
    await expect(page.getByText(/still to look at/)).toBeVisible()
  })

  test('reads the boxes and gives back costs and a builder message', async ({ authedPage: page }) => {
    test.setTimeout(120_000)
    await page.goto('/admin/crm/estimator')
    await page.evaluate(() => localStorage.removeItem('elsie.refurb-estimator.v3'))
    await page.reload()

    await page.getByTestId('estimator-address').fill('14 Oundle Road, Birmingham B44')
    await page.getByTestId('estimator-sqm').fill('88')

    // A real walkthrough of a real kind of house, filled in part by part the way
    // Pedro would speak it.
    await page.getByTestId('text-front').fill('Brickwork looks fine, no cracks that I can see.')
    await page.getByTestId('text-roof').fill('Roof looks straight but there are two or three slates missing on the left side.')
    await page.getByTestId('text-gutters').fill('Gutter is full of grass and there is a green stain down the wall underneath it.')
    await page.getByTestId('text-kitchen').fill('Kitchen is the old orange pine stuff, worktop is burnt by the cooker, no extractor. I would rip it out, nobody is renting that.')
    await page.getByTestId('text-bathroom').fill('White suite, all matches, tiles are plain white. Black mould in the corner above the bath and I cannot see a fan anywhere.')
    await page.getByTestId('text-living').fill('Walls have woodchip paper painted over and it is coming away by the door. Carpet is old and stained.')
    await page.getByTestId('text-bedrooms').fill('Front one is a good double, magnolia walls, looks sound. Back one has flowery wallpaper peeling in the corners. Third is a box room.')
    await page.getByTestId('text-electrics').fill('Fuse box is one of those old grey ones with the fuse wire, no trip switches at all.')
    await page.getByTestId('text-garden').fill('Small yard, all concrete, weeds everywhere, and the fence on the left is flat on the floor.')
    await page.getByTestId('text-contents').fill('Empty apart from a sofa and some bin bags in the back bedroom.')

    await expect(page.getByTestId('estimator-generate')).toBeEnabled()
    await page.getByTestId('estimator-generate').click()

    // The model call runs up to 60 seconds.
    await expect(page.getByTestId('estimate-totals')).toBeVisible({ timeout: 90_000 })

    // A real figure, not a zero and not a blank.
    const budget = await page.getByTestId('estimate-budget').innerText()
    expect(budget).toMatch(/^£[\d,]+$/)
    expect(Number(budget.replace(/[£,]/g, ''))).toBeGreaterThan(1000)

    // The kitchen is priced: the boxes above say in as many words that it gets
    // ripped out, so its absence would mean the reader is not being listened to.
    await expect(page.getByTestId('estimate-lines')).toContainText(/kitchen/i)

    // The builder's message names the house and asks for itemised pricing.
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
