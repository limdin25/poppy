import { test, expect } from '@playwright/test'

// "Copy link" on an inbox conversation copies a link that opens that conversation.
//
// Pedro, 2026-09-15: "how do i copy the URL that is specific like this? when I
// copy from hey elsie this shows up .../admin/crm/inbox". He pastes builder
// quote links into his QUOTES RECEIVED spreadsheet for Hugo.
//
//   E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... \
//   E2E_BASE_URL=https://app.heyelsie.com npx playwright test inbox-copy-link

test.use({ storageState: { cookies: [], origins: [] } })

const EMAIL = process.env.E2E_ADMIN_EMAIL
const PASSWORD = process.env.E2E_ADMIN_PASSWORD
const BETTRIDGE_CARD = '8eefc199-0ff8-4c57-9a1f-22cb4e4824eb'

test.describe('inbox copy link', () => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_ADMIN_EMAIL / _PASSWORD not set')

  test('copies a link to the open conversation, and the link opens it', async ({ page, context, baseURL }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL })
    await page.goto('/login')
    await page.locator('input[type="email"]').fill(EMAIL!)
    await page.locator('input[type="password"]').fill(PASSWORD!)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/admin|\/dashboard/, { timeout: 30_000 })

    await page.goto(`/admin/crm/inbox?contact=${BETTRIDGE_CARD}`)
    await expect(page.getByText(/Bettridges Quotation 125 Shakespeare/i).first()).toBeVisible({ timeout: 30_000 })

    await page.getByTestId('inbox-copy-link').click()
    await expect(page.getByText('Link copied').first()).toBeVisible({ timeout: 10_000 })
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    expect(copied).toBe(`${new URL(page.url()).origin}/admin/crm/inbox?contact=${BETTRIDGE_CARD}`)

    // The copied link, opened fresh, lands on the same conversation.
    await page.goto('/admin/crm/inbox')
    await page.goto(copied)
    await expect(page.getByText(/Bettridges Quotation 125 Shakespeare/i).first()).toBeVisible({ timeout: 30_000 })
  })
})
