import { test, expect } from '@playwright/test'

/**
 * CRM — the "From: …" caption in the dialer Messages tab must show the number
 * the SMS will ACTUALLY go from: the agent's own assigned line (country-
 * matched), never the workspace US toll-free default. Hugo 2026-07-23 — the
 * caption used to read the first active wk_numbers row (+18774194389) while
 * wk-sms-send really sent from the agent's UK number.
 *
 * Runs as a real agent login (Marr by default):
 *   E2E_AGENT_EMAIL=servidormarkyboy@gmail.com E2E_AGENT_PASSWORD=... \
 *     npx playwright test tests/e2e/crm-sms-from-line.spec.ts
 * E2E_AGENT_NUMBER overrides the expected line (use +447462167894 for Pedro).
 */
const EMAIL = process.env.E2E_AGENT_EMAIL
const PASSWORD = process.env.E2E_AGENT_PASSWORD
const EXPECTED_FROM = process.env.E2E_AGENT_NUMBER || '+447462192202'
const US_TOLLFREE = '+18774194389'

test.describe('CRM — Messages From line shows the agent’s own number', () => {
  test.skip(!EMAIL || !PASSWORD, 'needs E2E_AGENT_EMAIL / E2E_AGENT_PASSWORD')

  test('SMS From caption resolves the agent’s assigned UK number, not the US default', async ({ page, isMobile }) => {
    // On a phone the floating Power Dialer card (draggable, no close button)
    // overlays the composer until the agent drags it away — a pre-existing
    // layout quirk unrelated to this fix. The caption logic is
    // viewport-independent and covered on the desktop projects.
    test.skip(!!isMobile, 'floating dialer card covers the composer on mobile')

    await page.goto('/login')
    await page.locator('input[type="email"]').fill(EMAIL!)
    await page.locator('input[type="password"]').fill(PASSWORD!)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/admin\/crm/, { timeout: 25000 })

    await page.goto('/admin/crm/dialer-pro')

    // Messages tab (right column). Anchored regex — the header also has a
    // "New messages" button that a plain /Messages/ match can land on.
    await page.getByRole('button', { name: /^Messages/ }).click()

    const composer = page.locator('div.rounded-xl').filter({ hasText: /Send (SMS|Message) to/i })
    const smsRadio = page.getByRole('radio', { name: 'SMS', exact: true })

    // While the queue/contacts finish settling on page load, the MessagesTab
    // can flip to its "queue empty" branch and back, remounting the composer
    // and resetting the unpicked channel (PR 80 by design). Re-pick until the
    // From caption sticks.
    await expect(async () => {
      if ((await smsRadio.getAttribute('aria-checked')) !== 'true') {
        await smsRadio.click()
      }
      await expect(smsRadio).toHaveAttribute('aria-checked', 'true')
      // The composer's From caption must show the agent's assigned UK line…
      await expect(composer.locator('span.font-mono')).toContainText(EXPECTED_FROM, { timeout: 3000 })
    }).toPass({ timeout: 25000 })

    // …and never the workspace US toll-free default.
    await expect(composer.locator('span.font-mono')).not.toContainText(US_TOLLFREE)
  })
})
