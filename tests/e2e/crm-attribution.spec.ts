import { test, expect } from './helpers/auth'

/**
 * Lead attribution + the funnel lead drawer — Hugo 2026-07-27.
 *
 * "I and the team need to be able to open the lead during any stage on
 * /admin/crm/video-funnel and edit name, email, text, anything. Also leads must
 * always have the name of who it belongs to, on the card always, in all pages."
 *
 * SAFETY: runs against the live account. We NEVER send a text, approve a draft,
 * queue a render, or save a contact edit. We open panels and close them again.
 * The one destructive-looking control on the board ("Looks good — text it") is
 * never clicked, and neither is anything inside EditContactModal's footer.
 */

/** The board fetches after mount — counting straight after goto() finds zero
 *  cards and silently skips the whole suite. Wait for one to exist. */
async function openBoard(page: import('@playwright/test').Page) {
  await page.goto('/admin/crm/video-funnel')
  const card = page.locator('[data-testid^="funnel-card-"]').first()
  try {
    await card.waitFor({ state: 'visible', timeout: 20_000 })
  } catch {
    return null
  }
  return card
}

/** Click the card the way a human does — on its name.
 *  card.click() targets the geometric CENTRE, which on a "Ready to send" card is
 *  the <video>; that sits inside the stopPropagation wrapper on purpose so you
 *  can scrub the preview without the drawer flying open. */
async function openCard(card: import('@playwright/test').Locator) {
  await card.locator('div.text-\\[13px\\].font-bold').first().click()
}

test.describe('video funnel — open a lead at any stage', () => {
  test('clicking a card body opens the lead drawer', async ({ authedPage: page }) => {
    const card = await openBoard(page)
    if (!card) test.skip(true, 'no video pages on this account yet')

    await openCard(card!)
    const drawer = page.locator('[data-testid="funnel-lead-drawer"]')
    await expect(drawer).toBeVisible({ timeout: 8000 })

    // The two things Hugo asked for, on the same panel.
    await expect(drawer.getByTestId('funnel-drawer-edit')).toBeVisible()
    await expect(drawer.getByTestId('funnel-drawer-text')).toBeVisible()
  })

  test('the drawer carries the render timeline, not just the funnel stages', async ({ authedPage: page }) => {
    const card = await openBoard(page)
    if (!card) test.skip(true, 'no video pages on this account yet')

    await openCard(card!)
    const drawer = page.locator('[data-testid="funnel-lead-drawer"]')
    await expect(drawer).toBeVisible({ timeout: 8000 })
    // "date and time when agent click to create the video"
    await expect(drawer).toContainText('Video requested')
    await expect(drawer).toContainText('Page created')
    await expect(drawer).toContainText('Opened the page')
  })

  test('a card action button does NOT open the drawer', async ({ authedPage: page }) => {
    const card = await openBoard(page)
    if (!card) test.skip(true, 'no video pages on this account yet')

    // Copy link is safe to click and sits inside the stopPropagation wrapper.
    await card!.getByTitle('Copy link').click()
    await expect(page.locator('[data-testid="funnel-lead-drawer"]')).toHaveCount(0)
  })

  test('ESC closes the drawer', async ({ authedPage: page }) => {
    const card = await openBoard(page)
    if (!card) test.skip(true, 'no video pages on this account yet')

    await openCard(card!)
    const drawer = page.locator('[data-testid="funnel-lead-drawer"]')
    await expect(drawer).toBeVisible({ timeout: 8000 })
    await page.keyboard.press('Escape')
    await expect(drawer).toHaveCount(0)
  })
})

test.describe('the owning agent is named everywhere', () => {
  for (const [label, path] of [
    ['video funnel', '/admin/crm/video-funnel'],
    ['pipelines', '/admin/crm/pipelines'],
    ['contacts', '/admin/crm/contacts'],
    ['inbox', '/admin/crm/inbox'],
  ] as const) {
    test(`${label} renders an agent chip`, async ({ authedPage: page }) => {
      await page.goto(path)
      const chips = page.locator('[data-testid="agent-chip"]')
      try {
        await chips.first().waitFor({ state: 'visible', timeout: 20_000 })
      } catch {
        test.skip(true, `no leads visible on ${label}`)
      }
      // Whatever it says, it must not still be resolving.
      await expect(chips.first()).not.toHaveText('…', { timeout: 8000 })
    })
  }

  test('the pipeline board says where each card last moved', async ({ authedPage: page }) => {
    await page.goto('/admin/crm/pipelines')
    const chips = page.locator('[data-testid="stage-move-chip"]')
    await expect(chips.first()).toBeVisible({ timeout: 20_000 })
  })
})

test.describe('leaderboard follows "See as"', () => {
  test('an admin can pick an agent on the page itself', async ({ authedPage: page }) => {
    await page.goto('/admin/crm/leaderboard')
    const picker = page.getByTestId('leaderboard-agent-picker')
    // Must render for Hugo. It did not, until the admin source was corrected
    // from useCurrentAgent (wk_voice_agent_limits.is_admin = false for him) to
    // useAuth, the same source the "See as" switcher uses.
    await expect(picker).toBeVisible({ timeout: 20_000 })

    // Wait for the roster to land — reading the options too early used to skip
    // this test silently, which would have hidden an empty directory.
    await expect
      .poll(async () => picker.locator('option').count(), { timeout: 20_000 })
      .toBeGreaterThan(1)

    // Every agent stays on the board — Hugo's explicit choice.
    const rowsBefore = await page.locator('[data-testid^="leaderboard-row-"]').count()
    const options = await picker.locator('option').allTextContents()
    const target = options.find((o) => o && o !== 'Everyone')!

    await picker.selectOption({ label: target! })
    await page.waitForTimeout(2000)
    const rowsAfter = await page.locator('[data-testid^="leaderboard-row-"]').count()
    expect(rowsAfter).toBe(rowsBefore)
    // ...and that agent is called out.
    await expect(page.locator('body')).toContainText(/viewing/i)

    await picker.selectOption({ label: 'Everyone' })
  })
})

test.describe('dialer', () => {
  test('the contact pane has a pencil and the video button reads "Send as video"', async ({ authedPage: page }) => {
    await page.goto('/admin/crm/dialer-pro')
    const pencil = page.getByTestId('dialer-edit-contact')
    try {
      await pencil.waitFor({ state: 'visible', timeout: 20_000 })
    } catch {
      test.skip(true, 'no lead in the queue')
    }
    await expect(page.locator('body')).toContainText('Send as video')
  })
})
