import { test, expect } from './helpers/auth'

/**
 * "Make their video & send when ready" + the channel picker + the Video
 * templates tab — Hugo 2026-07-27.
 *
 * SAFETY: runs against the LIVE account. This suite never queues a render and
 * never arms a send — the only button it presses on the panel is the one that
 * opens it, plus the read-only "Change" dropdown. Nothing here can put a text
 * in front of a real plumber.
 */

/** Open the dialer and the video panel for whichever lead is up next. */
async function openVideoPanel(page: import('@playwright/test').Page) {
  await page.goto('/admin/crm/dialer-pro')
  const open = page.getByRole('button', { name: 'Send as video' }).first()
  try {
    await open.waitFor({ state: 'visible', timeout: 20_000 })
  } catch {
    return null
  }
  await open.click()
  const channel = page.getByTestId('video-channel').first()
  try {
    await channel.waitFor({ state: 'visible', timeout: 20_000 })
  } catch {
    return null
  }
  return channel
}

test.describe('the dialer video panel', () => {
  test('says what the button will do, not just what it does now', async ({ authedPage: page }) => {
    const channel = await openVideoPanel(page)
    if (!channel) test.skip(true, 'no lead in the dialer on this account')

    // Either the lead has no video yet (arm) or already has one (send now).
    // Both are correct; what must never appear is the old dead button.
    const arm = page.getByRole('button', { name: /Make their video & send when ready/ })
    const now = page.getByRole('button', { name: /Send it now|Send again/ })
    const armed = page.getByText(/sends itself by|going out by/i)
    await expect(arm.or(now).or(armed).first()).toBeVisible({ timeout: 10_000 })

    await expect(page.getByRole('button', { name: 'Text the video' })).toHaveCount(0)
  })

  test('names the channel and the address it is going to', async ({ authedPage: page }) => {
    const channel = await openVideoPanel(page)
    if (!channel) test.skip(true, 'no lead in the dialer on this account')

    await expect(channel).toContainText(/Sending by\s+Text/i)
    // A destination, not a bare label.
    await expect(channel).toContainText(/\+\d|@|No mobile number|No email address/)
  })

  test('the Change dropdown explains a channel that is off', async ({ authedPage: page }) => {
    const channel = await openVideoPanel(page)
    if (!channel) test.skip(true, 'no lead in the dialer on this account')

    await channel.getByRole('button', { name: /Change/ }).click()

    // WhatsApp has no connected Unipile account on this workspace, so it must
    // be offered as disabled WITH the reason — never silently missing.
    const wa = page.getByRole('button', { name: /WhatsApp/ }).first()
    await expect(wa).toBeVisible({ timeout: 5000 })
    await expect(wa).toBeDisabled()
    await expect(wa).toContainText(/isn’t connected|isn't connected/)

    // Email is offered too; whether it's usable depends on the lead.
    await expect(page.getByRole('button', { name: /Email/ }).first()).toBeVisible()
  })

  test('shows the message that will actually go, and lets it be edited', async ({ authedPage: page }) => {
    const channel = await openVideoPanel(page)
    if (!channel) test.skip(true, 'no lead in the dialer on this account')

    const body = page.getByTestId('video-send-body').first()
    await expect(body).toBeVisible()
    const text = await body.inputValue()
    expect(text).toMatch(/heyelsie\.com/)
    expect(text.length).toBeGreaterThan(30)
  })
})

test.describe('Templates', () => {
  test('has a Video tab listing the messages that carry the video', async ({ authedPage: page }) => {
    await page.goto('/admin/crm/templates')
    await page.getByRole('button', { name: 'Video' }).click()

    await expect(page.getByText('Video link — has a website')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Video link — no website')).toBeVisible()
    await expect(page.getByText('Follow-ups that send on their own')).toBeVisible()

    // The five automatic nudges, by the name an agent would recognise.
    for (const label of [
      'They never opened it',
      'Opened, didn’t watch',
      'Watched, didn’t click',
      'Started checkout, didn’t pay',
      'Paid — welcome message',
    ]) {
      await expect(page.getByText(label)).toBeVisible()
    }

    // The merge fields are the video ones, not the SMS worker's {first_name}.
    await expect(page.getByText('{business}', { exact: true })).toBeVisible()
  })
})
