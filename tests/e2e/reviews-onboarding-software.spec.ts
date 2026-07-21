import { test, expect } from '@playwright/test'

/**
 * After checkout, the reviews onboarding asks which software the client uses and
 * promises an integration link. Run against go.heyelsie.com with a reviews
 * client's creds. Does NOT click Continue, so it never persists crm_provider
 * (keeps the demo client re-runnable on the software step).
 */
const EMAIL = process.env.E2E_REVIEWS_EMAIL
const PASSWORD = process.env.E2E_REVIEWS_PASSWORD

test.describe('Reviews onboarding — software step', () => {
  test.skip(!EMAIL || !PASSWORD, 'needs E2E_REVIEWS_EMAIL / E2E_REVIEWS_PASSWORD')

  test('asks which software and promises an integration link', async ({ page }) => {
    // Reviews app login (go.heyelsie.com). Wait until the login form is gone so
    // the session is persisted before we navigate.
    await page.goto('/')
    await page.locator('input[type="email"]').fill(EMAIL!)
    await page.locator('input[type="password"]').fill(PASSWORD!)
    await page.getByRole('button', { name: /sign in/i }).click()
    await expect(page.locator('input[type="password"]')).toHaveCount(0, { timeout: 20000 })

    // ?paid=1 is the post-Stripe entry, which lands on the software step.
    await page.goto('/onboarding?paid=1')
    await expect(page.getByRole('heading', { name: /what do you use to run your jobs/i })).toBeVisible({ timeout: 20000 })

    // Picking a known tool shows the integration-link promise.
    await page.getByRole('button', { name: 'Jobber' }).click()
    await expect(page.getByText(/connection link today or tomorrow/i)).toBeVisible()
  })
})
