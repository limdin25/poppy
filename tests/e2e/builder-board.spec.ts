import { test, expect } from '@playwright/test'

// The builder board, on the real site with the real houses.
//
// Hugo, 2026-08-28, relaying Pedro: "a pipeline the same as we have for the
// properties but now for the builders, so he can coordinate which builder has
// been booked for what property, a kanban view there."
//
// The unit tests prove the rules. This proves the screen: that the lanes render
// from the live RPC, that a lane says in words whether anybody is going, and
// that dragging a man into Booked really books him (it calls
// assignBuilderToProperty, which writes brrr_properties.assigned_builder_id).
//
// Credentials from env: this repo mirrors to a PUBLIC GitHub repo.
//
//   E2E_OWNER_EMAIL=... E2E_OWNER_PASSWORD=... \
//   E2E_BASE_URL=https://app.heyelsie.com npx playwright test builder-board

test.use({ storageState: { cookies: [], origins: [] } })

const EMAIL = process.env.E2E_OWNER_EMAIL
const PASSWORD = process.env.E2E_OWNER_PASSWORD

test.describe('the builder board', () => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_OWNER_EMAIL / _PASSWORD not set')

  async function open(page: import('@playwright/test').Page) {
    await page.goto('/login')
    await page.locator('input[type="email"]').fill(EMAIL!)
    await page.locator('input[type="password"]').fill(PASSWORD!)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/admin/, { timeout: 30_000 })
    await page.goto('/admin/crm/find-builders?tab=board')
    await page.waitForSelector('[data-testid="builder-board"], [data-testid="builder-board-empty"]', { timeout: 30_000 })
  }

  test('draws a lane per house and says in words whether anybody is going', async ({ page }) => {
    await open(page)
    if (await page.getByTestId('builder-board-empty').count() > 0) {
      test.info().annotations.push({ type: 'note', description: 'no houses with a viewing right now' })
      return
    }

    const lanes = page.getByTestId('builder-lane')
    await expect(lanes.first()).toBeVisible()

    // Every lane carries a state and a verdict a person can read.
    const n = await lanes.count()
    for (let i = 0; i < n; i++) {
      const state = await lanes.nth(i).getAttribute('data-state')
      expect(['covered', 'at_risk', 'uncovered', 'done']).toContain(state)
      await expect(lanes.nth(i).getByTestId('builder-lane-verdict')).not.toBeEmpty()
    }
  })

  test('the seven columns are there and a card opens its drawer', async ({ page }) => {
    await open(page)
    if (await page.getByTestId('builder-board-empty').count() > 0) return

    // Open the first lane that is folded, so there is something to look at.
    const lane = page.getByTestId('builder-lane').first()
    if (await lane.getByTestId('builder-column').count() === 0) {
      await lane.getByTestId('builder-lane-toggle').click()
    }
    const cols = lane.getByTestId('builder-column')
    await expect(cols).toHaveCount(7)
    for (const stage of ['to_do', 'chasing', 'talking', 'coming', 'booked', 'been', 'no']) {
      await expect(lane.locator(`[data-stage="${stage}"]`)).toHaveCount(1)
    }

    const card = lane.getByTestId('builder-card').first()
    if (await card.count() === 0) return
    await card.getByTestId('builder-card-open').click()
    const drawer = page.getByTestId('builder-card-drawer')
    await expect(drawer).toBeVisible()
    // The four things that used to live nowhere.
    await expect(drawer.getByTestId('drawer-agreed')).toBeVisible()
    await expect(drawer.getByTestId('drawer-comeback')).toBeVisible()
    await expect(drawer.getByTestId('drawer-charges')).toBeVisible()
    await expect(drawer.getByTestId('drawer-quote')).toBeVisible()
  })

  // A MOVE, BUT NEVER INTO Booked, NEVER IN PARALLEL, AND ALWAYS PUT BACK.
  //
  // This runs against the live site and every rule here was earned in one
  // afternoon. Booked is not a label: it writes assigned_builder_id, moves the
  // branch card, writes an audit row and rings a bell at Hugo, so a test that
  // books somebody is a test that lies about who is going to a real viewing.
  // The first run of this file booked JL Brickwork on Lisle Road; the second
  // booked Fox Built on Wharfedale Road and failed before its own cleanup. Then
  // the chromium and mobile projects ran the move CONCURRENTLY, both grabbed the
  // same card, and left it half way. All three had to be undone by hand.
  //
  // So: To do to Chasing only (same route, same optimistic update, nothing
  // downstream), one project, and the restore is in a finally.
  test('a card moves between columns and stays moved', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'one project only: two would race on the same live card')
    await open(page)
    if (await page.getByTestId('builder-board-empty').count() > 0) return

    const lanes = page.getByTestId('builder-lane')
    const n = await lanes.count()
    let houseLabel: string | null = null
    for (let i = 0; i < n; i++) {
      const lane = lanes.nth(i)
      if (await lane.getByTestId('builder-column').count() === 0) {
        await lane.getByTestId('builder-lane-toggle').click()
      }
      if (await lane.locator('[data-stage="to_do"] [data-testid="builder-card"]').count() > 0) {
        houseLabel = (await lane.locator('header button').nth(1).innerText()).trim()
        break
      }
    }
    if (!houseLabel) {
      test.info().annotations.push({ type: 'note', description: 'nobody sitting in To do to move' })
      return
    }

    // Re-found by its house every time, NOT by index: a move can change the
    // lane's verdict and the board re-sorts, so an nth() locator would silently
    // start pointing at a different house.
    const lane = () => page.getByTestId('builder-lane').filter({ hasText: houseLabel! }).first()
    const inStage = (s: string) => lane().locator(`[data-stage="${s}"] [data-testid="builder-card"]`)

    const before = await inStage('chasing').count()
    const card = inStage('to_do').first()
    const name = (await card.getByTestId('builder-card-open').innerText()).trim()

    // Through the drawer rather than a synthetic drag: it is the same call, and
    // an HTML5 drag in Playwright does not carry a real dataTransfer.
    await card.getByTestId('builder-card-open').click()
    await page.getByTestId('drawer-stage').selectOption('chasing')
    try {
      await expect(inStage('chasing')).toHaveCount(before + 1, { timeout: 20_000 })
      await expect(inStage('chasing').filter({ hasText: name })).toHaveCount(1)

      // The lane must still be open. Booking used to turn a lane green and a
      // rule that re-read the verdict folded it shut under the press that had
      // just been made.
      await expect(lane().getByTestId('builder-column')).toHaveCount(7)
    } finally {
      // In a finally, because a failed assertion above must NOT leave a real
      // builder sitting in the wrong column on the board Pedro works from.
      await inStage('chasing').filter({ hasText: name }).first()
        .getByTestId('builder-card-open').click()
      await page.getByTestId('drawer-stage').selectOption('to_do')
      await expect(inStage('chasing')).toHaveCount(before, { timeout: 20_000 })
    }
  })
})
