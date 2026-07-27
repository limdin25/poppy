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

test.describe('video funnel — open a lead at any stage', () => {
  test('clicking a card body opens the lead drawer', async ({ authedPage: page }) => {
    await page.goto('/admin/crm/video-funnel')
    const card = page.locator('[data-testid^="funnel-card-"]').first()
    if ((await card.count()) === 0) test.skip(true, 'no video pages on this account yet')

    await card.click()
    const drawer = page.locator('[data-testid="funnel-lead-drawer"]')
    await expect(drawer).toBeVisible({ timeout: 8000 })

    // The two things Hugo asked for, on the same panel.
    await expect(drawer.getByTestId('funnel-drawer-edit')).toBeVisible()
    await expect(drawer.getByTestId('funnel-drawer-text')).toBeVisible()
  })

  test('the drawer carries the render timeline, not just the funnel stages', async ({ authedPage: page }) => {
    await page.goto('/admin/crm/video-funnel')
    const card = page.locator('[data-testid^="funnel-card-"]').first()
    if ((await card.count()) === 0) test.skip(true, 'no video pages on this account yet')

    await card.click()
    const drawer = page.locator('[data-testid="funnel-lead-drawer"]')
    await expect(drawer).toBeVisible({ timeout: 8000 })
    // "date and time when agent click to create the video"
    await expect(drawer).toContainText('Video requested')
    await expect(drawer).toContainText('Page created')
    await expect(drawer).toContainText('Opened the page')
  })

  test('a card action button does NOT open the drawer', async ({ authedPage: page }) => {
    await page.goto('/admin/crm/video-funnel')
    const card = page.locator('[data-testid^="funnel-card-"]').first()
    if ((await card.count()) === 0) test.skip(true, 'no video pages on this account yet')

    // Copy link is safe to click and sits inside the stopPropagation wrapper.
    await card.getByTitle('Copy link').click()
    await expect(page.locator('[data-testid="funnel-lead-drawer"]')).toHaveCount(0)
  })

  test('ESC closes the drawer', async ({ authedPage: page }) => {
    await page.goto('/admin/crm/video-funnel')
    const card = page.locator('[data-testid^="funnel-card-"]').first()
    if ((await card.count()) === 0) test.skip(true, 'no video pages on this account yet')

    await card.click()
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
      await page.waitForTimeout(2500) // let the roster + rows land
      const chips = page.locator('[data-testid="agent-chip"]')
      if ((await chips.count()) === 0) test.skip(true, `no leads visible on ${label}`)
      // Whatever it says, it must not still be resolving.
      await expect(chips.first()).not.toHaveText('…', { timeout: 8000 })
    })
  }

  test('the pipeline board says where each card last moved', async ({ authedPage: page }) => {
    await page.goto('/admin/crm/pipelines')
    await page.waitForTimeout(2500)
    const chips = page.locator('[data-testid="stage-move-chip"]')
    if ((await chips.count()) === 0) test.skip(true, 'no pipeline cards visible')
    await expect(chips.first()).toBeVisible()
  })
})

test.describe('leaderboard follows "See as"', () => {
  test('an admin can pick an agent on the page itself', async ({ authedPage: page }) => {
    await page.goto('/admin/crm/leaderboard')
    const picker = page.getByTestId('leaderboard-agent-picker')
    if ((await picker.count()) === 0) test.skip(true, 'not an admin on this account')

    // Every agent stays on the board — Hugo's explicit choice.
    const rowsBefore = await page.locator('[data-testid^="leaderboard-row-"]').count()
    const options = await picker.locator('option').allTextContents()
    const target = options.find((o) => o && o !== 'Everyone')
    if (!target) test.skip(true, 'no agents in the roster')

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
    await page.waitForTimeout(3000)
    const pencil = page.getByTestId('dialer-edit-contact')
    if ((await pencil.count()) === 0) test.skip(true, 'no lead in the queue')
    await expect(pencil).toBeVisible()
    await expect(page.locator('body')).toContainText('Send as video')
  })
})
