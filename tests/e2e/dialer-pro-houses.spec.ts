import { test, expect } from './helpers/auth'

/**
 * The Houses call room: /admin/crm/dialer-pro?script=property_call.
 *
 * Two things are being proved here, and the second matters more than the first.
 *
 * 1. Pedro's screen is right: the property script in the middle, the offer band
 *    pinned above it, the house in the LEFT column under a collapsible SMS
 *    history (Hugo, 2026-08-12), and the Coach open on the right with the
 *    plumber-only Calculator and Objections gone.
 *
 * 2. THE PLUMBER DIALER IS UNCHANGED. Pedro and Marr open the same room ~200
 *    times a day for plumbers. Every shared file this feature touched
 *    (DialerScriptPane, DialerRightTabs, interpolateScript, scriptForCall,
 *    useDialerMachine, ContactMetaCompact) defaults to the old behaviour, and
 *    the last test in this file is what proves that end to end rather than by
 *    reading the diff.
 *
 * Needs a CRM admin login (E2E_OWNER_READY=1 + E2E_EMAIL/E2E_PASSWORD), since
 * /admin/crm/* sits behind CrmGuard.
 */
test.describe('Dialer Pro — the Houses call', () => {
  test.skip(process.env.E2E_OWNER_READY !== '1', 'needs a CRM admin account (E2E_OWNER_READY=1)')

  test('property script + pinned offer band + the house in the left column', async ({ authedPage: page }) => {
    await page.goto('/admin/crm/dialer-pro?script=property_call')

    // COL 2 shows the property script, not the plumber one.
    await expect(page.getByText('Property call · estate agent')).toBeVisible({ timeout: 20000 })
    const frame = page.frameLocator('iframe[title="Property call · estate agent"]')
    await expect(frame.locator('body')).toContainText(/Is that one still available/i, { timeout: 15000 })

    // The parts of the script that stop an expensive mistake.
    await expect(frame.locator('body')).toContainText(/Never say this number out loud/i)
    await expect(frame.locator('body')).toContainText(/Never ask a house about service charges/i)

    // COL 3: the Coach, which is now what a property call opens on, and
    // Messages. The Houses tab moved out of this column entirely and the two
    // plumber tabs are still gone.
    // Exact: the CRM header gained a "Coach: ON" pill, so a loose /Coach/ now
    // matches two buttons and fails on strict mode. The tab is the one we mean.
    await expect(page.getByRole('button', { name: 'Coach', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /Messages/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Houses/ })).toBeHidden()
    await expect(page.getByRole('button', { name: /Calculator/ })).toBeHidden()
    await expect(page.getByRole('button', { name: /Objections/ })).toBeHidden()

    // COL 1: the SMS history folded away at the top, the house underneath it.
    // Soft, because COL 1 shows "No leads in queue" when the queue is empty and
    // an empty queue is not a broken layout.
    if (await page.getByTestId('dialer-sms-toggle').isVisible().catch(() => false)) {
      await expect(page.getByTestId('dialer-houses-panel')).toBeVisible()
      // Shut by default, and it opens on a click.
      await expect(page.getByText('SMS history appears once a call connects.')).toBeHidden()
      await page.getByTestId('dialer-sms-toggle').click()
      await expect(page.getByText('SMS history appears once a call connects.')).toBeVisible()
      await page.getByTestId('dialer-sms-toggle').click()
      await expect(page.getByText('SMS history appears once a call connects.')).toBeHidden()
    }
  })

  test('the offer band is pinned above the script, not inside a tab', async ({ authedPage: page }) => {
    await page.goto('/admin/crm/dialer-pro?script=property_call')
    await expect(page.getByText('Property call · estate agent')).toBeVisible({ timeout: 20000 })

    // With no lead on screen it says so plainly rather than showing a blank
    // space where three figures should be.
    const strip = page.getByText(/No property selected|Open at/)
    await expect(strip.first()).toBeVisible()

    // If a branch IS loaded, the three labels are all visible at once without
    // clicking anything. That is the whole point of pinning it.
    const openAt = page.getByText('Open at', { exact: true })
    if (await openAt.isVisible().catch(() => false)) {
      await expect(page.getByText('Then climb', { exact: true })).toBeVisible()
      await expect(page.getByText('Walk away at', { exact: true })).toBeVisible()
      await expect(page.getByText('NEVER SAY THIS OUT LOUD')).toBeVisible()
    }
  })

  test('REGRESSION: a normal dial is exactly as it was', async ({ authedPage: page }) => {
    await page.goto('/admin/crm/dialer-pro')

    // The cold script, and the original four tabs with Calculator first.
    await expect(page.getByText('Sales script', { exact: true })).toBeVisible({ timeout: 20000 })
    await expect(page.getByText('Gap calculator')).toBeVisible()
    await expect(page.getByRole('button', { name: /Objections/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Messages/ })).toBeVisible()

    // Nothing from the Houses feature leaks in, in either column.
    await expect(page.getByRole('button', { name: /Houses/ })).toBeHidden()
    await expect(page.getByTestId('dialer-houses-panel')).toBeHidden()
    await expect(page.getByTestId('dialer-sms-toggle')).toBeHidden()
    await expect(page.getByText('Walk away at')).toBeHidden()
    await expect(page.getByText('NEVER SAY THIS OUT LOUD')).toBeHidden()
  })

  test('an unknown ?script= falls back to the cold call, never to houses', async ({ authedPage: page }) => {
    // The query string decides which words an agent reads down a live line, so
    // it is an allowlist. Anything unrecognised must land on the cold script.
    await page.goto('/admin/crm/dialer-pro?script=whatever_i_typed')
    await expect(page.getByText('Sales script', { exact: true })).toBeVisible({ timeout: 20000 })
    await expect(page.getByRole('button', { name: /Houses/ })).toBeHidden()
  })
})
