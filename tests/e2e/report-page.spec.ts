import { test, expect } from '@playwright/test'

// /report — the password-gated sales-operation audit (Hugo 2026-07-24).
// Verifies the real gate + all four tabs render + a call row expands.

test.describe('/report audit page', () => {
  test('gate blocks, code 1176 opens, tabs and call table work', async ({ page }) => {
    await page.goto('/report')
    await expect(page.locator('h1')).toContainText('Sales Operation Audit')

    // wrong code stays on the gate
    await page.fill('input[name=pw]', '0000')
    await page.click('button')
    await expect(page.locator('.err')).toContainText('Wrong code')

    // right code opens the report
    await page.fill('input[name=pw]', '1176')
    await page.click('button')
    await expect(page.locator('h1')).toContainText('Sales Operation Audit')
    await expect(page.locator('.kpi').first()).toBeVisible()
    await expect(page.getByText('Paying customers')).toBeVisible()

    // Pedro tab: discipline table + audited call table
    await page.locator('.tab', { hasText: 'Pedro' }).click()
    await expect(page.getByRole('heading', { name: 'Hours & discipline' }).first()).toBeVisible()
    const pedroRows = page.locator('#pt tbody tr.cr')
    expect(await pedroRows.count()).toBeGreaterThan(50)

    // expanding a row reveals audit detail
    await pedroRows.first().click()
    await expect(page.locator('#p0')).toBeVisible()

    // Marr tab renders with the fair-play mic note
    await page.locator('.tab', { hasText: 'Marr' }).click()
    await expect(page.getByText('microphone fault').first()).toBeVisible()

    // Hugo tab: expert panel present
    await page.locator('.tab', { hasText: 'For Hugo' }).click()
    await expect(page.getByText('Expert panel')).toBeVisible()
    await expect(page.getByText('worth continuing')).toBeVisible()
  })
})
