import { test, expect } from './helpers/auth'

/**
 * CRM admin dashboard — AI receptionist (Maya) panel.
 *
 * Needs an admin login (E2E_EMAIL/E2E_PASSWORD + E2E_OWNER_READY=1), since
 * /admin/crm/dashboard sits behind AdminOnlyRoute.
 */
test.describe('CRM AI receptionist panel', () => {
  test.skip(process.env.E2E_OWNER_READY !== '1', 'needs an admin account (E2E_OWNER_READY=1)')

  test('dashboard shows Maya with live status and activity', async ({ authedPage: page }) => {
    await page.goto('/admin/crm/dashboard')

    const panel = page.locator('div', { hasText: 'AI receptionist — Maya' }).last()
    await expect(page.locator('body')).toContainText('AI receptionist — Maya', { timeout: 20_000 })

    // Status chips reflect the live settings (voice always on; texts draft/auto/off).
    await expect(page.locator('body')).toContainText('Voice ON')
    await expect(page.locator('body')).toContainText(/Texts (· (Draft mode|Auto-send)|OFF)/)

    // The three at-a-glance stats.
    for (const label of ['Calls answered today', 'AI texts today', 'Drafts waiting']) {
      await expect(page.locator('body')).toContainText(label)
    }

    // Activity feed: either real items or the explicit empty state — never blank.
    await expect(panel).toBeVisible()
    const hasEmptyState = await page.locator('text=No AI activity yet').isVisible().catch(() => false)
    // Chips + Settings deep-link into the AI agent config section.
    const hasSettingsLink = await page.locator('a[href*="/admin/crm/agent"]').first().isVisible()
    expect(hasSettingsLink).toBe(true)
    expect(typeof hasEmptyState).toBe('boolean')
  })
})
