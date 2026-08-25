import { test, expect } from '@playwright/test'

// The refurb estimator, against the real thing.
//
// Hugo, 2026-08-25: "The estimator page should show properties that are booked
// for viewing/inspection by the agent. The agent selects a property from a
// dropdown, then sees property name, size, listing information, all relevant
// property photos, and every property area requiring assessment. Every item
// must require agent confirmation, even if the information came directly from
// the listing or AI."
//
// So the two things worth proving in a browser are the two that no unit test
// can: that choosing a house actually pulls the advert and its photographs off
// Rightmove, and that the Generate button refuses to price anything until a
// human has pressed Confirm on a part of the property.
//
// The AI reading itself is NOT run here. It costs money per press and it is
// already covered where it belongs, in tests/refurb-assessment.test.ts, which
// pins the merge that decides what any reading is allowed to turn into.
//
// Credentials come from env on purpose (this repo mirrors to a public one):
//
//   E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... \
//   E2E_BASE_URL=https://app.heyelsie.com npx playwright test refurb-estimator
//
// Skips cleanly when they are not set.

test.use({ storageState: { cookies: [], origins: [] } })

const EMAIL = process.env.E2E_ADMIN_EMAIL
const PASSWORD = process.env.E2E_ADMIN_PASSWORD

test.describe('the refurb estimator', () => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_ADMIN_EMAIL / _PASSWORD not set')

  test('picks a house booked for a viewing, pulls the advert, and prices nothing until confirmed', async ({ page }) => {
    await page.goto('/login')
    await page.locator('input[type="email"]').fill(EMAIL!)
    await page.locator('input[type="password"]').fill(PASSWORD!)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/admin|\/dashboard/, { timeout: 30_000 })

    await page.goto('/admin/crm/estimator')
    const picker = page.getByTestId('estimator-property')
    await expect(picker).toBeVisible({ timeout: 30_000 })

    // The dropdown is the houses with a viewing booked. Option 0 is the
    // "Choose a property" placeholder, which is on the page before the fetch
    // has answered, so waiting for "more than none" waits for nothing at all.
    // An empty list after the wait is a real state of the world (nobody has
    // booked a viewing), not a failure.
    const options = picker.locator('option')
    await expect.poll(() => options.count(), { timeout: 30_000 }).toBeGreaterThan(1)
      .catch(() => { /* really is empty, handled by the skip below */ })
    const count = await options.count()
    test.skip(count < 2, 'no properties are booked in for a viewing right now')

    const value = await options.nth(1).getAttribute('value')
    await picker.selectOption(value!)

    // The advert, fetched server side while he waited.
    const houseCard = page.getByTestId('house-card')
    await expect(houseCard).toBeVisible({ timeout: 60_000 })

    // THE BIG PICTURE, STUCK TO THE TOP. Hugo: "the way the photo is on Zoopla,
    // big, and the photo is always displayed on top. The way you put now I have
    // to click on the photos and then takes me to an outside page, it's not good."
    const stage = page.getByTestId('stage-photo')
    await expect(stage).toBeVisible({ timeout: 30_000 })
    const firstSrc = await stage.getAttribute('src')

    // Picking another one swaps the big picture. It does NOT leave the page.
    await page.getByTestId('stage-thumb-2').click()
    await expect.poll(() => stage.getAttribute('src')).not.toBe(firstSrc)
    expect(page.url()).toContain('/admin/crm/estimator')

    // And it expands INSIDE the app, over the whole window.
    await stage.click()
    const full = page.getByTestId('stage-fullscreen')
    await expect(full).toBeVisible()
    const box = await full.boundingBox()
    const view = page.viewportSize()!
    expect(box!.width).toBeGreaterThanOrEqual(view.width - 2)
    expect(box!.height).toBeGreaterThanOrEqual(view.height - 2)
    await full.click({ position: { x: 5, y: 5 } })
    await expect(full).toBeHidden()

    // SCROLLING TO A PART OF THE PROPERTY BRINGS ITS PHOTOGRAPH UP. Hugo: "we
    // can scroll the website and then we can speak on the boxes or rewrite or
    // confirm as we look on the photos." Only meaningful once a reading has put
    // photographs against the sections, so it is skipped on an unread house.
    await page.getByTestId('section-kitchen').scrollIntoViewIfNeeded()
    const kitchenPhotos = await page.getByTestId('photos-kitchen').count()
    if (kitchenPhotos > 0) {
      await expect
        .poll(() => stage.getAttribute('alt'), { timeout: 10_000 })
        .toMatch(/Kitchen/i)
      // And it is still stuck to the top of the window while he does it.
      const stageBox = await stage.boundingBox()
      expect(stageBox!.y).toBeLessThan(view.height / 2)
    }

    // Every part of the property is on the page, whether or not anything has
    // read it. The checklist is the point: he can see what he has not looked at.
    await expect(page.getByTestId('section-kitchen')).toBeVisible()
    await expect(page.getByTestId('section-electrics')).toBeVisible()
    await expect(page.getByTestId('section-damp')).toBeVisible()

    // NOTHING IS PRICED UNTIL A HUMAN CONFIRMS IT. With nothing confirmed the
    // button is dead, and that is the whole safety story of this screen.
    await expect(page.getByTestId('sections-done')).toHaveText('0')
    await expect(page.getByTestId('estimator-generate')).toBeDisabled()

    // Confirm one part and it comes alive, counting confirmations rather than
    // filled-in boxes.
    await page.getByTestId('confirm-kitchen').click()
    await expect(page.getByTestId('sections-done')).toHaveText('1')
    await expect(page.getByTestId('estimator-generate')).toBeEnabled()

    // And a part he calls Nothing to do stays confirmed and carries no money.
    await page.getByTestId('verdict-bathroom-nothing').click()
    await page.getByTestId('confirm-bathroom').click()
    await expect(page.getByTestId('sections-done')).toHaveText('2')

    await page.getByTestId('estimator-generate').click()
    await expect(page.getByTestId('estimate-totals')).toBeVisible({ timeout: 60_000 })

    // Ex VAT everywhere, and no VAT added. Hugo: "Prices must be shown
    // EXCLUDING VAT. Do not add VAT."
    await expect(page.getByTestId('estimate-totals')).toContainText(/excluding VAT/i)
    const brief = page.getByTestId('builder-brief')
    await expect(brief).toBeVisible()
    await expect(brief).toContainText(/excluding VAT/i)

    // And it never admits we have not been inside. Hugo: "Do NOT tell the
    // builder that we have not viewed the property."
    await expect(brief).not.toContainText(/only seen photographs|not (yet )?(viewed|been inside|seen the property)/i)
  })
})
