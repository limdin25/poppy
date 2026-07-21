import { test, expect } from '@playwright/test'

/**
 * Public agent onboarding — /join.
 *
 * Proves the real deployment end-to-end through the UI:
 *   config API renders the editable agreement → sign the agreement (name +
 *   drawn signature) → email step calls /api/agent-onboarding/sign → the
 *   "check your email" (verify) step appears.
 *
 * Stops before creating an account (that needs the emailed code), so it leaves
 * only one throwaway signup row (cleaned by the psql step in the run script).
 * No login required — the page is public.
 */
test.describe('Agent onboarding /join', () => {
  test('renders the agreement and reaches the email-code step', async ({ page }) => {
    // Resend's designated test recipient — accepted + simulated, never a real
    // inbox. The sign endpoint clears prior in-progress rows for the same email,
    // so re-runs don't accumulate signups.
    const email = 'delivered@resend.dev'

    await page.goto('/join')

    // Agreement comes from the admin-editable wk_agent_agreement row via the
    // config API. Header + at least one seeded term must render.
    await expect(page.getByRole('heading', { name: /working agreement/i })).toBeVisible()
    await expect(page.locator('body')).toContainText(/Your role/i)
    const signBtn = page.getByRole('button', { name: /sign .* continue/i })
    await expect(signBtn).toBeVisible()

    // Name + a drawn signature. The pad listens for PointerEvents, so dispatch
    // them directly (page.mouse doesn't reliably reach the canvas handlers).
    await page.getByPlaceholder('Jane Smith').fill('E2E Test Agent')
    await page.locator('canvas').evaluate((el: HTMLCanvasElement) => {
      const r = el.getBoundingClientRect()
      const pe = (type: string, x: number, y: number, target: EventTarget) =>
        target.dispatchEvent(new PointerEvent(type, { clientX: r.left + x, clientY: r.top + y, bubbles: true }))
      pe('pointerdown', 20, 40, el)
      pe('pointermove', 120, 90, el)
      pe('pointermove', 200, 55, el)
      pe('pointermove', 260, 80, el)
      pe('pointerup', 260, 80, window)
    })

    await signBtn.click()

    // Acknowledgement pop-up: every box must be ticked before it lets you on.
    await expect(page.getByRole('heading', { name: /before you sign/i })).toBeVisible()
    const confirmBtn = page.getByRole('button', { name: /complete my signature/i })
    await expect(confirmBtn).toBeDisabled()
    for (const box of await page.locator('input[type="checkbox"]').all()) {
      await box.check()
    }
    await expect(confirmBtn).toBeEnabled()
    await confirmBtn.click()

    // Email step.
    await expect(page.getByRole('heading', { name: /your email/i })).toBeVisible()
    await page.getByPlaceholder('you@example.com').fill(email)
    await page.getByRole('button', { name: /send code/i }).click()

    // Verify step — proves /api/agent-onboarding/sign accepted the signature and
    // queued the code email.
    await expect(page.getByRole('heading', { name: /check your email/i })).toBeVisible({ timeout: 15000 })
    await expect(page.locator('body')).toContainText(email)
    await expect(page.getByPlaceholder('123456')).toBeVisible()
  })
})
