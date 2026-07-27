import { test, expect } from './helpers/auth'

/**
 * Pressing play has to move the card.
 *
 * Hugo 2026-07-27: "if Ignition Heating and Plumbing Ltd was watched why it
 * under opened". David had played the video and got 26% in. The board only had
 * an Opened column and a Watched column (50%+), so he sat in Opened looking
 * identical to a lead who tapped the link and wandered off, and the board read
 * as broken.
 *
 * Fixed by carving a virtual 'playing' column out of state 'opened' with
 * play_at, NOT by lowering the watched threshold: a lead who quit at 26% and
 * one who sat through 96% are different phone calls, and merging them makes
 * Watched useless for choosing who to ring. That distinction is what the last
 * assertion here defends.
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

test('a lead who pressed play sits in Playing, not Opened', async ({ authedPage: page }) => {
  await boardAsMarr(page)

  const playing = page.getByTestId('funnel-col-playing')
  await expect(playing).toContainText('Playing')
  // David played at 16:34 and stopped at 26% — under the 50% Watched bar.
  await expect(playing).toContainText('Ignition Heating and Plumbing Ltd')

  // ...and he is no longer sitting among the leads who only tapped the link.
  await expect(page.getByTestId('funnel-col-opened'))
    .not.toContainText('Ignition Heating and Plumbing Ltd')
})

test('Playing does not swallow the leads who actually watched it', async ({ authedPage: page }) => {
  await boardAsMarr(page)

  // James reached 96%. If the threshold had been lowered instead of adding this
  // column, he and David would be in the same box and the column would stop
  // telling an agent who to ring.
  await expect(page.getByTestId('funnel-col-watched')).toContainText('HeatGen')
  await expect(page.getByTestId('funnel-col-playing')).not.toContainText('HeatGen')
})

test('the coverage number never reads as a stage name', async ({ authedPage: page }) => {
  await boardAsMarr(page)

  // "watched 26%" on a card sitting in Opened is what made the board look like
  // it was contradicting itself.
  const board = page.locator('[data-testid^="funnel-col-"]')
  await expect(board.first()).toBeVisible()
  const text = (await board.allTextContents()).join(' | ')
  expect(text, `board still says "watched N%":\n${text}`).not.toMatch(/watched \d+%/)
  await expect(page.getByTestId('funnel-col-playing')).toContainText('26% of video')
})
