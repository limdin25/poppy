import { test, expect } from '@playwright/test'

/**
 * /script — the PIN-gated one-call sales script. Public (no login). Wrong PIN is
 * refused; 1176 reveals the script inside an iframe.
 */
test.describe('PIN-gated call script', () => {
  test('rejects a wrong PIN and reveals the script on 1176', async ({ page }) => {
    await page.goto('/script')

    // Gate is shown, script is NOT yet in the DOM.
    await expect(page.getByRole('heading', { name: /enter pin/i })).toBeVisible()
    await expect(page.locator('iframe')).toHaveCount(0)

    // Wrong PIN is refused.
    await page.locator('input').fill('0000')
    await page.getByRole('button', { name: /unlock/i }).click()
    await expect(page.getByText(/wrong pin/i)).toBeVisible()
    await expect(page.locator('iframe')).toHaveCount(0)

    // Correct PIN reveals the script iframe, and its content rendered.
    await page.locator('input').fill('1176')
    await page.getByRole('button', { name: /unlock/i }).click()
    const frame = page.frameLocator('iframe')
    await expect(frame.locator('body')).toContainText(/One-Call Close/i, { timeout: 10000 })
    const text = await frame.locator('body').innerText()
    // The cleaned script has no long dashes.
    expect(text).not.toMatch(/[—–―‒]/)
    // £1 bank-check language removed (the £179 price legitimately contains "£1").
    expect(text).not.toContain('£1 check')
    expect(text).not.toContain('check from your bank')
    // Google-connect step no longer uses the scary "management rights" framing.
    expect(text).not.toContain('management rights')
    // CRM step now promises the integration link today/tomorrow.
    expect(text).toContain('connection link today or tomorrow')
    expect(text).not.toContain('set up in a week or two')
    // CRM step reframed around review reactivation; the clunky opener is gone.
    expect(text).toContain('review reactivation')
    expect(text).not.toContain('forgot to mention')
    // Same-day list flow: the list is due this afternoon, not "next day".
    expect(text).toContain('before you get busy')
    expect(text).toContain('built tonight')
    expect(text).not.toContain('three or four days')
    // Google step reassures they can finish later on the dashboard (no scare).
    expect(text).toContain('management access')
    expect(text).toContain('dashboard')
    // CRM/integration demoted to an explicit nice-to-have.
    expect(text).toContain('nice-to-have')
  })
})
