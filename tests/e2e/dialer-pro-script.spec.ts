import { test, expect } from './helpers/auth'

/**
 * Dialer Pro reorg: the sales script (COL 2) is lean + editable (admin), and the
 * right column (COL 3) is a 3-tab panel — Calculator (default) / Objections /
 * Messages — with the keypad reachable from the dialer card. Needs a CRM admin
 * login (E2E_OWNER_READY=1 + E2E_EMAIL/E2E_PASSWORD), since /admin/crm/* sits
 * behind CrmGuard.
 */
test.describe('Dialer Pro — tabs, script, keypad', () => {
  test.skip(process.env.E2E_OWNER_READY !== '1', 'needs a CRM admin account (E2E_OWNER_READY=1)')

  test('sales script + Calculator/Objections/Messages tabs + keypad button', async ({ authedPage: page }) => {
    await page.goto('/admin/crm/dialer-pro')

    // The sales script pane renders the script content in its iframe.
    await expect(page.getByText('Sales script', { exact: true })).toBeVisible({ timeout: 20000 })
    const frame = page.frameLocator('iframe[title="Sales script"]')
    await expect(frame.locator('body')).toContainText(/One-Call Close/i, { timeout: 15000 })
    // Admin sees Edit + Print on the script header; the script's own
    // "Open all objections" toolbar is hidden in the lean dialer view.
    await expect(page.getByRole('button', { name: /^Edit$/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Print$/ })).toBeVisible()
    await expect(frame.getByText('Open all objections')).toHaveCount(0)

    // Right panel opens on Calculator; the gap output reacts to the inputs.
    await expect(page.getByText('Gap calculator')).toBeVisible()
    await expect(page.getByText('reviews they should have (at 20%)')).toBeVisible()

    // Objections tab: searchable rebuttals.
    await page.getByRole('button', { name: /Objections/ }).click()
    await expect(page.getByPlaceholder('Search objections…')).toBeVisible()
    await expect(page.getByText('If they ask')).toBeVisible()

    // Messages tab present (send box + history live here now).
    await expect(page.getByRole('button', { name: /Messages/ })).toBeVisible()

    // The dialer card has a keypad button next to "Power Dialer".
    await expect(page.getByText('Power Dialer')).toBeVisible()
    await expect(page.getByRole('button', { name: /Open keypad/i })).toBeVisible()
  })
})
