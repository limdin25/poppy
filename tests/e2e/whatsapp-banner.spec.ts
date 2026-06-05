import { test, expect } from './helpers/auth'

/**
 * WhatsApp-disconnect banner.
 *
 * The demo business (demo.user@heyelsie.com → "Demo WhatsApp Co") has a
 * WhatsApp channel in the dropped state, so the global red alert stripe must
 * render on every page with a "Reconnect now" action.
 */
test.describe('whatsapp disconnect banner', () => {
  test('red stripe with reconnect shows on dashboard and inbox', async ({ authedPage }) => {
    // Dashboard (authedPage already landed on the app shell).
    await expect(
      authedPage.getByText(/disconnected/i).first(),
    ).toBeVisible({ timeout: 15_000 })
    await expect(
      authedPage.getByText(/isn't receiving or replying/i),
    ).toBeVisible()
    const reconnect = authedPage.getByRole('button', { name: /reconnect now/i })
    await expect(reconnect).toBeVisible()

    // Capture proof for review.
    await authedPage.screenshot({ path: 'playwright-report/banner-dashboard.png' })

    // Banner is global — also present on the inbox.
    await authedPage.goto('/inbox')
    await expect(
      authedPage.getByText(/disconnected/i).first(),
    ).toBeVisible({ timeout: 15_000 })
    await expect(
      authedPage.getByRole('button', { name: /reconnect now/i }),
    ).toBeVisible()
    await authedPage.screenshot({ path: 'playwright-report/banner-inbox.png' })
  })

  test('reconnect button calls the reconnect endpoint and returns a hosted link', async ({ authedPage }) => {
    // Intercept the window.open so the test doesn't spawn a real tab, and assert
    // the endpoint returns a Unipile hosted URL (the proper reconnect path).
    const respPromise = authedPage.waitForResponse(
      (r) => r.url().includes('/api/channels/whatsapp/reconnect'),
      { timeout: 15_000 },
    )
    await authedPage.evaluate(() => {
      ;(window as any).open = () => null
    })
    await authedPage.getByRole('button', { name: /reconnect now/i }).click()
    const resp = await respPromise
    expect(resp.status()).toBe(200)
    const body = await resp.json()
    expect(body.url, 'reconnect endpoint should return a hosted link').toContain('account.unipile.com')
  })
})
