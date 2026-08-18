import { test, expect } from '@playwright/test'

// Call two, opened from the pipeline board, is a CALLBACK from the first line.
//
// Hugo, 2026-08-18, watching Jones & Chapman (Ready for call 2, ballpark
// confirmed) open on the cold "Is that one still available?": "on call number
// two that we make the call directly from the pipeline, it should not open
// the first script, this is a callback."
//
// Credentials come from env on purpose (this repo mirrors to a public one):
//
//   E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... \
//   E2E_BASE_URL=https://app.heyelsie.com npx playwright test property-call2-script
//
// Skips cleanly when they are not set. THE BOARD'S PHONE ICON AUTO-DIALS
// (openDialerPro passes autoDial), so every road a dial can take is blocked
// BEFORE the click: the room still mounts and renders the script, and no
// real estate agent's phone rings because a test ran.

test.use({ storageState: { cookies: [], origins: [] } })

const EMAIL = process.env.E2E_ADMIN_EMAIL
const PASSWORD = process.env.E2E_ADMIN_PASSWORD

test.describe('a Ready-for-call-2 card opens on the callback script', () => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_ADMIN_EMAIL / _PASSWORD not set')

  test('the pane is CALL 2 and the cold opener is gone', async ({ page }) => {
    await page.goto('/login')
    await page.locator('input[type="email"]').fill(EMAIL!)
    await page.locator('input[type="password"]').fill(PASSWORD!)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/admin|\/dashboard/, { timeout: 30_000 })

    // Block the dial BEFORE anything can press it. wk-calls-create files the
    // call row and wk-dialer-start places it; Twilio is belt and braces.
    await page.route('**/functions/v1/wk-calls-create*', (r) => r.fulfill({ status: 503, body: '{}' }))
    await page.route('**/functions/v1/wk-dialer-start*', (r) => r.fulfill({ status: 503, body: '{}' }))
    await page.route('**/*twilio*/**', (r) => r.abort())

    await page.goto('/admin/crm/pipelines')
    const column = page.getByText('READY FOR CALL 2', { exact: false }).first()
    await column.waitFor({ timeout: 30_000 }).catch(() => {})

    // The phone icon on the first card in that column. Cards render the
    // action row on hover; the button carries the phone icon.
    const columnBox = page.locator('div', { hasText: /Ready for call 2/i }).first()
    const phoneBtn = columnBox.locator('button:has(svg.lucide-phone)').first()
    const hasCard = await phoneBtn.count().then((c) => c > 0).catch(() => false)
    test.skip(!hasCard, 'no card in Ready for call 2 right now')

    await phoneBtn.click()

    // The dialer modal opens on the property room. The pane header must say
    // call two, in red, and the script iframe must open on the callback.
    await expect(page.getByText('Property call · CALL 2, THE OFFER')).toBeVisible({ timeout: 30_000 })

    const frame = page.frameLocator('iframe[title="Property call · estate agent"]')
    await expect(frame.getByText(/We spoke .*about/i).first()).toBeVisible({ timeout: 30_000 })
    await expect(frame.getByText("it's Pedro from Unico").first()).toBeVisible()
    // The whole bug: the cold opener used to render first on call two.
    await expect(frame.getByText('Is that one still available?')).toHaveCount(0)
  })
})
