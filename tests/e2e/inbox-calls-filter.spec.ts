import { test, expect } from './helpers/auth'

/**
 * CRM inbox → Calls/Voicemail/Missed pills now source from wk_calls, not
 * message threads. Regression guard: clicking "Calls" must NOT render the
 * SMS inbox (previously the pill was a no-op, so SMS contacts like the
 * +18774194389 test number showed through). Needs admin (E2E_OWNER_READY=1).
 */
test.describe('CRM inbox calls filter', () => {
  test.skip(process.env.E2E_OWNER_READY !== '1', 'needs an admin account (E2E_OWNER_READY=1)')

  test('Calls pill does not show the SMS inbox', async ({ authedPage: page }) => {
    await page.goto('/admin/crm/inbox')
    await expect(page.getByTestId('inbox-filter-calls')).toBeVisible({ timeout: 20_000 })

    // Let the inbox settle on ALL first.
    await page.getByTestId('inbox-filter-all').click()
    await page.waitForTimeout(1500)
    const asideAll = page.locator('aside').first()

    // Switch to Calls — the sidebar must reflect call data only.
    await page.getByTestId('inbox-filter-calls').click()
    await page.waitForTimeout(1200)
    const callsText = await asideAll.innerText()

    // The SMS message prefix must not appear under Calls.
    expect(callsText).not.toContain('💬')
    // Every visible row under Calls must be a call row (icon-driven), never
    // an SMS thread. Assert no SMS body glyph and that call rows, if any,
    // carry a call label or the empty state shows.
    const okCalls = /No calls yet\.|Missed call|Voicemail|Call/.test(callsText) || callsText.trim() === ''
    expect(okCalls).toBeTruthy()

    // Missed is status-scoped.
    await page.getByTestId('inbox-filter-missed').click()
    await page.waitForTimeout(1000)
    const missedText = await asideAll.innerText()
    expect(missedText).not.toContain('💬')
  })
})
