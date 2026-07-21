import { test, expect } from '@playwright/test'

/**
 * A CRM contractor agent (workspace_role='agent', no receptionist business) must
 * land in the CRM after login, not on the empty receptionist dashboard, and must
 * not see admin-only options. Needs a throwaway agent's creds via env; the run
 * script creates one, runs this, then deletes it.
 */
const EMAIL = process.env.E2E_AGENT_EMAIL
const PASSWORD = process.env.E2E_AGENT_PASSWORD

test.describe('CRM agent login routing', () => {
  test.skip(!EMAIL || !PASSWORD, 'needs E2E_AGENT_EMAIL / E2E_AGENT_PASSWORD')

  test('a contractor agent lands on the CRM, admin options hidden', async ({ page }) => {
    await page.goto('/login')
    await page.locator('input[type="email"]').fill(EMAIL!)
    await page.locator('input[type="password"]').fill(PASSWORD!)
    await page.locator('button[type="submit"]').click()

    // Routed into the CRM inbox (not /dashboard).
    await page.waitForURL(/\/admin\/crm\/inbox/, { timeout: 25000 })
    expect(page.url()).toContain('/admin/crm/inbox')

    // Admin-only sidebar items (Settings, Dashboard, AI agent) are hidden.
    await expect(page.locator('a[href="/admin/crm/settings"]')).toHaveCount(0)
    await expect(page.locator('a[href="/admin/crm/dashboard"]')).toHaveCount(0)
    // Agent-accessible nav (Inbox) is present.
    await expect(page.locator('a[href*="/admin/crm/inbox"]:visible').first()).toBeVisible({ timeout: 15000 })

    // The CRM header has a working Sign out button.
    const signOut = page.getByRole('button', { name: /sign out/i })
    await expect(signOut).toBeVisible()
    await signOut.click()
    await page.waitForURL(/\/login/, { timeout: 20000 })
  })
})
