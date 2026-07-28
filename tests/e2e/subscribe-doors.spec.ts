import { test, expect } from '@playwright/test'

// Public reviews pages — no auth. Absolute go.heyelsie.com URLs so this runs
// with `--no-deps` (skip the app.heyelsie.com login setup).
test.use({ storageState: undefined })

const GO = 'https://go.heyelsie.com'
const stamp = Date.now()
const TEST_EMAIL = `doortest+${stamp}@heyelsie.com`

test.describe('Subscribe / onboarding — the 3 doors', () => {
  test('/subscribe renders email-only, pay-first', async ({ page }) => {
    await page.goto(`${GO}/subscribe?crm=00000000-0000-0000-0000-000000000000&business=DoorTest%20Co&email=${encodeURIComponent(TEST_EMAIL)}`)
    await expect(page.getByRole('heading', { name: /Start your subscription/i })).toBeVisible({ timeout: 25000 })
    // Email-only: NO password field on the subscribe door.
    await expect(page.locator('input[type="password"]')).toHaveCount(0)
    // Prefills from the link the agent sent.
    await expect(page.getByPlaceholder('Business name')).toHaveValue('DoorTest Co')
    await expect(page.locator('input[type="email"]')).toHaveValue(TEST_EMAIL)
    await expect(page.getByRole('button', { name: /Continue to payment/i })).toBeVisible()
  })

  test('/subscribe: creating the account lands on the PLAN step (pay-first)', async ({ page }) => {
    await page.goto(`${GO}/subscribe?business=DoorTest%20Co&email=${encodeURIComponent(TEST_EMAIL)}`)
    await expect(page.getByRole('heading', { name: /Start your subscription/i })).toBeVisible({ timeout: 25000 })
    await page.getByRole('button', { name: /Continue to payment/i }).click()
    // Pay-first: straight to the plan picker, not the contacts step.
    await expect(page.getByRole('heading', { name: /Choose your plan/i })).toBeVisible({ timeout: 25000 })
    await expect(page.getByText(/Starter|Growth|Pro/).first()).toBeVisible()
    // Stop here — do NOT click a plan (that would open a live Stripe session).
  })

  test('/continue renders the email + code login', async ({ page }) => {
    await page.goto(`${GO}/continue`)
    await expect(page.getByRole('heading', { name: /Continue your setup/i })).toBeVisible({ timeout: 25000 })
    await expect(page.getByRole('button', { name: /Send me a code/i })).toBeVisible()
  })

  test('/onboarding is unchanged (full form with password)', async ({ page }) => {
    await page.goto(`${GO}/onboarding`)
    await expect(page.getByRole('heading', { name: /Create your account/i })).toBeVisible({ timeout: 25000 })
    // The normal door still asks for a password.
    await expect(page.locator('input[type="password"]')).toHaveCount(1)
  })
})
