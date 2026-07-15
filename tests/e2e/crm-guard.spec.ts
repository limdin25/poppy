import { test, expect } from '@playwright/test'

/**
 * CRM access isolation. Uses the saved demo session (demo.user@heyelsie.com) —
 * a normal signed-in user who is NOT in admin_users and has NO CRM
 * workspace_role. Proves the two guards Hugo required:
 *   1. Non-agents cannot enter the CRM (CrmGuard → "CRM access required").
 *   2. Non-admins cannot enter the rest of the admin panel (AdminGuard →
 *      bounced to /dashboard). This is what keeps sales agents scoped to the
 *      CRM only.
 */

test('non-agent is blocked from the CRM', async ({ page }) => {
  await page.goto('/admin/crm')
  // CrmGuard renders the access-required screen for a signed-in user with no role.
  await expect(page.getByText(/CRM access required/i)).toBeVisible({ timeout: 15_000 })
  // And must NOT show CRM app chrome (e.g. the Inbox/Dialer sidebar items).
  await expect(page.getByRole('link', { name: /Dialer/i })).toHaveCount(0)
})

test('non-admin is bounced from the admin panel to /dashboard', async ({ page }) => {
  await page.goto('/admin/users')
  await page.waitForURL(/\/dashboard/, { timeout: 15_000 })
  expect(new URL(page.url()).pathname).toBe('/dashboard')
})
