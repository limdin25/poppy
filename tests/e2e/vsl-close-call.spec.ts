import { test, expect } from './helpers/auth'

/**
 * The video funnel's "Call to close" button, and the second sales script behind
 * it.
 *
 * Hugo 2026-07-31: a lead who has watched their video needs a phone button on
 * the board that opens the call room with a DIFFERENT script ("I saw you
 * watched it, what did you think?"), and that script "cannot affect the other
 * scripts" — the cold-call one Pedro and Marr read on every dial.
 *
 * CLICKING THE BUTTON IS SAFE, AND ONE TEST BELOW PROVES WHY. Hugo 2026-07-31:
 * "wait for it to open and then give the option for the agent to call, don't
 * call just straight away." The funnel passes autoDial:false, so the button
 * stages the lead behind a Call button and rings nobody. The test that clicks
 * it asserts exactly that, and would catch a regression to auto-dialling by
 * failing rather than by ringing a real plumber.
 *
 * The remaining script assertions still go through the ?script= route, which
 * renders the same pane with no lead staged at all.
 */

const MARR = { id: '7b677273-f330-43c7-b21a-6242d6f8881a', name: 'Marr Roland Servidor' }

async function boardAsMarr(page: import('@playwright/test').Page) {
  await page.goto('/admin/crm/video-funnel')
  await page.evaluate((a) => {
    localStorage.setItem('crm_view_as', JSON.stringify({ id: a.id, name: a.name }))
  }, MARR)
  await page.reload()
  await page.locator('[data-testid^="funnel-card-"]').first().waitFor({ timeout: 20_000 })
  await page.waitForTimeout(4000) // let any late fetch land
}

// SELECTOR NOTE, learned the hard way 2026-07-31: the funnel CARD itself is
// role="button" (it opens the drawer), and its accessible name is all of its
// text, which now includes "Call to close". So
// getByRole('button', {name: /Call to close/i}) resolves to the CARD, and
// clicking it opens the drawer instead of the call room. Always target the
// button by its data-testid.
const CLOSE_BTN = '[data-testid^="funnel-close-call-"]'

test('a lead who watched the video gets a Call to close button', async ({ authedPage: page }) => {
  await boardAsMarr(page)

  const watched = page.getByTestId('funnel-col-watched')
  await expect(watched).toContainText('Watched')
  // Same lead the playing/watched split is pinned on — he reached 96%.
  await expect(watched).toContainText('HeatGen')
  await expect(watched.locator(CLOSE_BTN).first()).toBeVisible()
})

test('leads who have not seen the pitch do NOT get the button', async ({ authedPage: page }) => {
  await boardAsMarr(page)

  // Ringing someone to ask what they thought of a video they never opened is
  // the cold call, not this one — and mid-video means interrupting the pitch.
  for (const col of ['created', 'sent', 'opened', 'playing']) {
    const cards = page.getByTestId(`funnel-col-${col}`).locator('[data-testid^="funnel-card-"]')
    if ((await cards.count()) === 0) continue
    await expect(page.getByTestId(`funnel-col-${col}`).locator(CLOSE_BTN)).toHaveCount(0)
  }
})

test('pressing Call to close opens the room and rings NOBODY', async ({ authedPage: page }) => {
  // Hugo 2026-07-31: "wait for it to open and then give the option for the
  // agent to call, don't call just straight away." This is the one test that
  // may click the button, precisely BECAUSE it must not dial.
  const dialled: string[] = []
  page.on('request', (r) => { if (r.url().includes('wk-calls-create')) dialled.push(r.url()) })

  await boardAsMarr(page)
  await page.locator(CLOSE_BTN).first().click()

  // The room is up, on the close script, with the lead parked behind a Call button.
  await expect(page.getByTestId('dialer-call-staged')).toBeVisible({ timeout: 25_000 })
  await expect(page.getByTestId('dialer-call-staged')).toContainText(/^\s*Call \S/)
  await expect(page.getByText('Close script · they watched the video')).toBeVisible()

  await page.waitForTimeout(3000)
  expect(dialled, `it dialled without being asked: ${dialled.join(', ')}`).toHaveLength(0)
})

test('the close script replaces the cold opener, and only when asked for', async ({ authedPage: page }) => {
  // ── the close script ──
  await page.goto('/admin/crm/dialer-pro?script=vsl_close')
  await expect(page.getByText('Close script · they watched the video')).toBeVisible({ timeout: 20_000 })

  const closeFrame = page.frameLocator('iframe[title="Close script · they watched the video"]')
  await expect(closeFrame.locator('body')).toContainText(/They watched the video/i, { timeout: 15_000 })
  // The four beats Hugo dictated, in order.
  await expect(closeFrame.locator('body')).toContainText(/calling you back about that video I sent you over/i)
  await expect(closeFrame.locator('body')).toContainText(/I could see you'd watched it/i)
  await expect(closeFrame.locator('body')).toContainText(/have you got any questions about it/i)
  await expect(closeFrame.locator('body')).toContainText(/something you'd like to get started with/i)
  // The opener Hugo rejected ("hey you alright, doesn't sound normal"). Scoped to
  // the SPOKEN lines: the coaching note quotes the phrase to say don't say it, so
  // a whole-body check fails on its own instruction.
  const spoken = (await closeFrame.locator('.line').allTextContents()).join(' | ')
  expect(spoken, `spoken lines still contain the rejected opener:\n${spoken}`)
    .not.toMatch(/you alright/i)
  // And the first spoken line is the plain identify, nothing before it.
  expect(spoken).toMatch(/^\s*YOU:\s*"Hi, is that /i)
  // The cold-call script's own title must not be in here.
  await expect(closeFrame.locator('body')).not.toContainText(/The 2-Minute Audit/i)

  // ── the cold script, untouched ──
  // This is the regression that matters: every normal dial still gets the
  // cold-call script, byte for byte what it was before the second one existed.
  await page.goto('/admin/crm/dialer-pro')
  await expect(page.getByText('Sales script', { exact: true })).toBeVisible({ timeout: 20_000 })
  const coldFrame = page.frameLocator('iframe[title="Sales script"]')
  await expect(coldFrame.locator('body')).toContainText(/The 2-Minute Audit/i, { timeout: 15_000 })
  await expect(coldFrame.locator('body')).not.toContainText(/I could see you'd watched it/i)
})
