import { test, expect } from './helpers/auth'

/**
 * Dialer Pro now shows the one-call SALES SCRIPT live (COL 2), with the
 * old live-transcript column removed and the Glossary tab dropped from the
 * messages pane. Needs a CRM-capable admin login (E2E_OWNER_READY=1 +
 * E2E_EMAIL/E2E_PASSWORD), since /admin/crm/* sits behind CrmGuard.
 */
test.describe('Dialer Pro — sales script pane', () => {
  test.skip(process.env.E2E_OWNER_READY !== '1', 'needs a CRM admin account (E2E_OWNER_READY=1)')

  test('shows the sales script, no transcript column, no glossary tab', async ({ authedPage: page }) => {
    await page.goto('/admin/crm/dialer-pro')

    // The Sales script pane header + its iframe are present, and the script
    // content rendered inside it.
    await expect(page.getByText('Sales script', { exact: true })).toBeVisible({ timeout: 20000 })
    const frame = page.frameLocator('iframe[title="Sales script"]')
    await expect(frame.locator('body')).toContainText(/One-Call Close/i, { timeout: 15000 })

    // The old live-transcript column is gone.
    await expect(page.getByText('Transcript appears during calls')).toHaveCount(0)

    // Messages tab stays; the Glossary tab is removed from the dialer.
    await expect(page.getByRole('button', { name: /Messages/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Glossary/ })).toHaveCount(0)
  })
})
