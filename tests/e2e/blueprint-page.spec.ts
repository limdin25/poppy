import { test, expect } from '@playwright/test'

/**
 * /blueprint — the PIN-gated dev environment checklist for people learning to
 * code with Claude. Public (no login). Same PIN as /script, 1176. Progress is
 * saved in a cookie so it survives a reload.
 */
test.describe('PIN-gated dev blueprint', () => {
  test('rejects a wrong PIN, reveals the checklist on 1176, and persists ticked steps', async ({ page }) => {
    await page.goto('/blueprint')

    // Gate is shown, checklist not yet in the DOM.
    await expect(page.getByRole('heading', { name: /enter pin/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /set up your coding environment/i })).toHaveCount(0)

    // Wrong PIN is refused.
    await page.locator('input').fill('0000')
    await page.getByRole('button', { name: /unlock/i }).click()
    await expect(page.getByText(/wrong pin/i)).toBeVisible()

    // Correct PIN reveals the checklist.
    await page.locator('input').fill('1176')
    await page.getByRole('button', { name: /unlock/i }).click()
    await expect(page.getByRole('heading', { name: /set up your coding environment/i })).toBeVisible()

    // All three sections and the opening step are present.
    await expect(page.getByText('1. Get Claude working on your computer')).toBeVisible()
    await expect(page.getByText('2. From here, just ask Claude')).toBeVisible()
    await expect(page.getByText('3. Start building')).toBeVisible()
    await expect(page.getByText('Download Cursor')).toBeVisible()
    await expect(page.getByText('Get your app sending emails')).toBeVisible()
    await expect(page.getByText('Get paid (Stripe)')).toBeVisible()
    await expect(page.getByText('0 / 14 done')).toBeVisible()

    // Only the first three steps are "do it yourself" — no Ask Claude chip.
    // Everything from Supabase onward hands the exact sentence to Claude.
    await expect(page.getByText(/Ask Claude: .Please create me a free Supabase account/)).toBeVisible()
    await expect(page.getByText(/Ask Claude: .Please set up a free Stripe account/)).toBeVisible()
    await expect(
      page.getByText(/Ask Claude: .Here are my logins for Supabase, Vercel.*Resend and Stripe/)
    ).toBeVisible()
    await expect(
      page.getByText(/Ask Claude: .Please create a CLAUDE\.md file.*own Supabase project/)
    ).toBeVisible()
    await expect(page.getByText(/Ask Claude: .Please build me a brand new page, or a whole new app on its own subdomain/)).toBeVisible()

    // Ticking a step updates the counter and survives a reload (cookie).
    await page.getByText('Download Cursor').click()
    await expect(page.getByText('1 / 14 done')).toBeVisible()
    await page.reload()
    await expect(page.getByText('1 / 14 done')).toBeVisible()
    await expect(page.getByRole('heading', { name: /enter pin/i })).toHaveCount(0)

    // Hovering the "!" reveals the explanation for that step.
    const tip = page.locator('button[aria-label="What is this for?"]').first()
    await tip.hover()
    await expect(page.getByText(/cursor\.com/i)).toBeVisible()

    // Reset clears progress.
    await page.getByRole('button', { name: /reset progress/i }).click()
    await expect(page.getByText('0 / 14 done')).toBeVisible()
  })
})
