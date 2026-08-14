import { test, expect } from './helpers/auth'

/**
 * Admin → Builders (/admin/builders) and its wiring into a property's
 * Viewing section on /admin/properties.
 *
 * Hugo, 2026-08-14: wants a VA to arrange viewings using a roster of local
 * builders matched by postcode, so nobody drives across the country for one
 * house. This proves the roster CRUD and that an assignment made on a
 * property actually persists.
 *
 * Needs an OWNER/admin login, same gate as the Numbers admin spec. Enable with
 * E2E_OWNER_READY=1; a non-admin account gets bounced by AdminGuard.
 */
test.describe('Builders roster', () => {
  test.skip(process.env.E2E_OWNER_READY !== '1', 'needs an admin account (E2E_OWNER_READY=1)')

  const builderName = `Test Builder ${Math.floor(Math.random() * 100000)}`

  test('add a builder, assign them to a property, then remove them', async ({ authedPage: page }) => {
    await page.goto('/admin/builders')
    await expect(page.locator('body')).toContainText(/Builders/i)

    // Add a builder covering a made-up outcode so the match is unambiguous.
    await page.getByRole('button', { name: /add builder/i }).click()
    await page.locator('input').first().fill(builderName)
    await page.getByPlaceholder('LE7, LE, NN1').fill('ZZ9')
    await page.getByRole('button', { name: /^save$/i }).click()

    const row = page.locator('tr', { hasText: builderName })
    await expect(row).toBeVisible({ timeout: 10_000 })
    await expect(row).toContainText('ZZ9')
    await expect(row).toContainText('Active')

    // Toggle it inactive and back, proving the PUT round-trips.
    await row.getByRole('button', { name: 'Active' }).click()
    await expect(row.getByRole('button', { name: 'Inactive' })).toBeVisible({ timeout: 10_000 })
    await row.getByRole('button', { name: 'Inactive' }).click()
    await expect(row.getByRole('button', { name: 'Active' })).toBeVisible({ timeout: 10_000 })

    // Assign this builder to whatever property sits on top of the list, and
    // confirm the assignment survives a reload.
    await page.goto('/admin/properties')
    const firstRow = page.locator('table tbody tr').first()
    await expect(firstRow).toBeVisible({ timeout: 15_000 })
    await firstRow.click()

    const drawer = page.locator('text=Viewing').locator('..').locator('..')
    await expect(page.getByText('Viewing', { exact: true })).toBeVisible({ timeout: 10_000 })
    await page.locator('select').selectOption({ label: builderName })
    await page.getByRole('button', { name: /save viewing/i }).click()
    await expect(page.getByRole('button', { name: /save viewing/i })).toBeEnabled({ timeout: 10_000 })

    await page.reload()
    await firstRow.click()
    await expect(page.locator('select')).toHaveValue(/.+/, { timeout: 10_000 })
    const selectedLabel = await page.locator('select').locator('option:checked').textContent()
    expect(selectedLabel).toBe(builderName)
    void drawer

    // Clear the assignment so the fixture doesn't leave a live house pointed
    // at a builder that's about to be deleted.
    await page.locator('select').selectOption({ label: 'Unassigned' })
    await page.getByRole('button', { name: /save viewing/i }).click()
    await expect(page.getByRole('button', { name: /save viewing/i })).toBeEnabled({ timeout: 10_000 })

    // Cleanup: remove the test builder.
    await page.goto('/admin/builders')
    const cleanupRow = page.locator('tr', { hasText: builderName })
    page.once('dialog', (d) => d.accept())
    await cleanupRow.getByRole('button').last().click()
    await expect(page.locator('tr', { hasText: builderName })).toHaveCount(0, { timeout: 10_000 })
  })
})
