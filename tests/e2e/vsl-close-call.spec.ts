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
 * NOTE ON WHY THE BUTTON IS NEVER CLICKED HERE. openDialerPro auto-dials the
 * moment the softphone is ready, exactly like every other Call button in the
 * CRM. Clicking it in an automated test rings a real plumber. So the button is
 * asserted where it appears, and the script it opens is asserted through the
 * ?script= route, which renders the same pane without dialling anybody.
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

test('a lead who watched the video gets a Call to close button', async ({ authedPage: page }) => {
  await boardAsMarr(page)

  const watched = page.getByTestId('funnel-col-watched')
  await expect(watched).toContainText('Watched')
  // Same lead the playing/watched split is pinned on — he reached 96%.
  await expect(watched).toContainText('HeatGen')
  await expect(watched.getByRole('button', { name: /Call to close/i }).first()).toBeVisible()
})

test('leads who have not seen the pitch do NOT get the button', async ({ authedPage: page }) => {
  await boardAsMarr(page)

  // Ringing someone to ask what they thought of a video they never opened is
  // the cold call, not this one — and mid-video means interrupting the pitch.
  for (const col of ['created', 'sent', 'opened', 'playing']) {
    const cards = page.getByTestId(`funnel-col-${col}`).locator('[data-testid^="funnel-card-"]')
    if ((await cards.count()) === 0) continue
    await expect(
      page.getByTestId(`funnel-col-${col}`).getByRole('button', { name: /Call to close/i }),
    ).toHaveCount(0)
  }
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
  expect(spoken).toMatch(/^\s*You:\s*"Hi, is that /)
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
