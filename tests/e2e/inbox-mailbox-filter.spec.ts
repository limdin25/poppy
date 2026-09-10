import { test, expect } from './helpers/auth'

/**
 * Mailbox filter on the CRM inbox (Hugo 2026-09-10).
 * Pedro gets pedro.a@hostunico.com as a clean line and can switch between
 * that and pedro@hostunico.com without the threads mixing.
 */

test.describe('inbox mailbox filter', () => {
  test.skip(process.env.E2E_OWNER_READY !== '1', 'needs an admin account (E2E_OWNER_READY=1)')

  test('email pill reveals a mailbox select with Pedro lines', async ({ authedPage: page }) => {
    await page.goto('/admin/crm/inbox')
    await expect(page.getByTestId('inbox-filter-email')).toBeVisible({ timeout: 20_000 })
    await page.getByTestId('inbox-filter-email').click()

    const select = page.getByTestId('inbox-mailbox-filter')
    await expect(select).toBeVisible({ timeout: 15_000 })

    const options = await select.locator('option').allTextContents()
    const joined = options.join(' | ').toLowerCase()
    expect(joined).toMatch(/all mailboxes|all/)
    expect(joined).toMatch(/pedro\.a|pedro\.a@hostunico\.com/)
    expect(joined).toMatch(/pedro@hostunico\.com|pedro(?!\.a)/)

    await select.selectOption({ label: /pedro\.a/i })
    await expect(select).toHaveValue(/pedro\.a@hostunico\.com/i)
  })
})
