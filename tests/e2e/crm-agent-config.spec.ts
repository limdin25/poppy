import { test, expect } from './helpers/auth'

/**
 * CRM AI agent section (/admin/crm/agent) — the ported /agents UI for Maya.
 * Needs an admin login (E2E_EMAIL/E2E_PASSWORD + E2E_OWNER_READY=1).
 */
test.describe('CRM AI agent config', () => {
  test.skip(process.env.E2E_OWNER_READY !== '1', 'needs an admin account (E2E_OWNER_READY=1)')

  test('voice tab seeds from Maya\'s live Retell brain', async ({ authedPage: page }) => {
    await page.goto('/admin/crm/agent')

    // Shell renders with the channel pills, defaulting to Calls.
    await expect(page.locator('body')).toContainText('AI agent — Maya', { timeout: 20_000 })
    for (const pill of ['Calls', 'SMS', 'Email', 'WhatsApp']) {
      await expect(page.getByRole('button', { name: pill, exact: true })).toBeVisible()
    }

    // The system prompt textarea fills with the REAL saved voice brain
    // (the plumber sales script as of 2026-07-16).
    const promptBox = page.locator('textarea').nth(1)
    await expect(promptBox).toHaveValue(/Elsie|plumb/i, { timeout: 20_000 })
  })

  test('SMS tab shows the warm-up engine settings and saves', async ({ authedPage: page }) => {
    await page.goto('/admin/crm/agent/personality?ch=sms')

    await expect(page.locator('body')).toContainText('Reply delay (seconds)', { timeout: 20_000 })
    await expect(page.locator('body')).toContainText('Max replies per lead')
    await expect(page.locator('body')).toContainText('Handoff keywords')

    // Round-trip save (values unchanged — harmless write proving RLS + wiring).
    await page.getByRole('button', { name: /save changes/i }).click()
    await expect(page.getByRole('button', { name: /^Saved$/i })).toBeVisible({ timeout: 10_000 })
  })

  test('email tab is config-only with an honest banner', async ({ authedPage: page }) => {
    await page.goto('/admin/crm/agent/personality?ch=email')
    await expect(page.locator('body')).toContainText(/isn't switched on yet/i, { timeout: 20_000 })
  })

  test('call behaviour page loads Maya\'s live voice settings', async ({ authedPage: page }) => {
    await page.goto('/admin/crm/agent/calling?ch=voice')
    await expect(page.locator('body')).toContainText("Maya's voice", { timeout: 20_000 })
    // Seeded from live Retell: her current voice is cartesia-Willa.
    await expect(page.locator('select').first()).toHaveValue(/willa/i)
  })

  test('old ai-warmup route redirects into the new section', async ({ authedPage: page }) => {
    await page.goto('/admin/crm/ai-warmup')
    await expect(page).toHaveURL(/\/admin\/crm\/agent\/personality\?ch=sms/, { timeout: 15_000 })
  })
})
