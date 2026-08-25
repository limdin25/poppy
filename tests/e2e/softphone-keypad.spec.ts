import { test, expect } from './helpers/auth'

/**
 * The soft dialer's IVR keypad.
 *
 * Hugo 2026-08-25: "during the call he's asking to press a number to move
 * forward, but when we use the soft dialer there is no option to press any
 * number." A switchboard menu answered, and the call was already lost.
 *
 * WHAT A BROWSER CAN PROVE HERE, AND WHAT IT CANNOT.
 *
 * The mid-call bar only exists while a Twilio Call is up, and no automated
 * test in this repo can put a real call on the line: it needs mic permission,
 * a live PSTN leg and a real switchboard on the other end. So the click-to-
 * tone path is pinned by the component tests instead, which assert the exact
 * thing that was missing:
 *
 *   src/features/crm/components/softphone/__tests__/Softphone.dtmf.test.tsx
 *   src/features/crm/components/live-call/__tests__/ActiveCallContext.dtmf.test.tsx
 *
 * (Those live under src/features/crm/**, which vitest.config.ts excludes, so
 * they run with an explicit jsdom config. See the worklog entry.)
 *
 * What this spec covers is the regression risk of the same edit: the softphone
 * is on the file that changed, and it still has to open and dial from every
 * CRM page. The last assertion is the live one, and it is gated because it
 * needs a call in progress.
 */
test.describe('Softphone still opens and dials after the keypad change', () => {
  test.skip(process.env.E2E_OWNER_READY !== '1', 'needs a CRM login (E2E_OWNER_READY=1)')

  test('launcher opens the softphone with its dial pad intact', async ({ authedPage: page }) => {
    await page.goto('/admin/crm/inbox')

    const launcher = page.getByText('Softphone', { exact: true })
    await expect(launcher).toBeVisible({ timeout: 15000 })
    await launcher.click()

    // The idle panel: caller-ID picker, number box, keys, Call button.
    await expect(page.getByText('Calling from')).toBeVisible({ timeout: 10000 })
    await expect(page.getByPlaceholder('+44 7XXX XXX XXX')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Call' })).toBeVisible()
  })

  test('typing on the pad builds the number to dial', async ({ authedPage: page }) => {
    await page.goto('/admin/crm/inbox')
    await page.getByText('Softphone', { exact: true }).click()

    const box = page.getByPlaceholder('+44 7XXX XXX XXX')
    await expect(box).toBeVisible({ timeout: 10000 })
    await page.getByRole('button', { name: '1', exact: true }).click()
    await page.getByRole('button', { name: '2', exact: true }).click()
    await page.getByRole('button', { name: '3', exact: true }).click()
    await expect(box).toHaveValue('123')
  })

  /**
   * THE LIVE ONE. Ring anything with a menu on it, then run:
   *
   *   E2E_OWNER_READY=1 E2E_ON_CALL=1 E2E_BASE_URL=https://app.heyelsie.com \
   *     npx playwright test softphone-keypad --project=chromium
   *
   * Do not run it while Pedro is on the phones.
   */
  test('mid-call, the bar carries a keypad that sends tones', async ({ authedPage: page }) => {
    test.skip(process.env.E2E_ON_CALL !== '1', 'needs a call already in progress')

    await page.goto('/admin/crm/inbox')
    await expect(page.getByText(/^In call/)).toBeVisible({ timeout: 20000 })

    await page.getByText('Keypad', { exact: true }).click()
    const pad = page.getByTestId('softphone-dtmf-keypad')
    await expect(pad).toBeVisible()

    await pad.getByTitle('Send 1').click()
    await expect(pad).toContainText('1')
  })
})
