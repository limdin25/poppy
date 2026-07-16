import { test, expect } from './helpers/auth'

/**
 * Admin → Number Management (/admin/numbers).
 *
 * Needs an OWNER/admin login (E2E_EMAIL/E2E_PASSWORD in auth.setup), same gate as
 * the CEO cockpit spec. Enable with E2E_OWNER_READY=1; a non-admin account gets
 * bounced by AdminGuard, so the spec is skipped otherwise.
 */
test.describe('Admin number management', () => {
  test.skip(process.env.E2E_OWNER_READY !== '1', 'needs an admin account (E2E_OWNER_READY=1)')

  test('lists every number with assignment and supports note tags', async ({ authedPage: page }) => {
    await page.goto('/admin/numbers')

    await expect(page.locator('body')).toContainText(/Number Management/i)

    // Live inventory: both UK lines with their assignments.
    await expect(page.locator('body')).toContainText('+447426495169')
    await expect(page.locator('body')).toContainText('+447576558278')
    await expect(page.locator('body')).toContainText(/Elsie Demo Line/i)

    // Table columns are present.
    for (const header of ['Number', 'Assigned To', 'Status', 'Provider', 'Note']) {
      await expect(page.locator('th', { hasText: header }).first()).toBeVisible()
    }

    // Save a note on the spare US number and see it render as a tag.
    const spareRow = page.locator('tr', { hasText: '+17755460276' })
    await expect(spareRow).toBeVisible()
    await spareRow.getByRole('button', { name: /add note|spare/i }).first().click()
    const input = spareRow.locator('input')
    await input.fill('Spare US number')
    await input.press('Enter')
    await expect(spareRow.locator('span', { hasText: 'Spare US number' }).first()).toBeVisible({ timeout: 10_000 })

    // The note survives a reload (persisted via number_notes).
    await page.reload()
    await expect(page.locator('tr', { hasText: '+17755460276' })).toContainText('Spare US number', { timeout: 15_000 })
  })
})
