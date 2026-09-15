import { test, expect } from '@playwright/test'

// A builder's emailed quote is on the builder's own card in the inbox.
//
// Hugo, 2026-09-15: "we cant find quote this guys send again". C E Bettridge &
// Son Ltd's quote for 125 Shakespeare Street was filed on a separate contact
// named "jon_bettridge@outlook.com". It was moved onto the builder card and the
// email webhook now routes a builder's mail there (api/lib/builder-email-match.ts).
//
//   E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... \
//   E2E_BASE_URL=https://app.heyelsie.com npx playwright test builder-quote-on-card
//
// Skips cleanly when the credentials are not set.

test.use({ storageState: { cookies: [], origins: [] } })

const EMAIL = process.env.E2E_ADMIN_EMAIL
const PASSWORD = process.env.E2E_ADMIN_PASSWORD
const BETTRIDGE_CARD = '8eefc199-0ff8-4c57-9a1f-22cb4e4824eb'

test.describe('builder quotes', () => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_ADMIN_EMAIL / _PASSWORD not set')

  test('the Bettridge quote and its file are on the C E Bettridge & Son Ltd thread', async ({ page }) => {
    await page.goto('/login')
    await page.locator('input[type="email"]').fill(EMAIL!)
    await page.locator('input[type="password"]').fill(PASSWORD!)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/admin|\/dashboard/, { timeout: 30_000 })

    await page.goto(`/admin/crm/inbox?contact=${BETTRIDGE_CARD}`)
    await expect(page.getByText('C E Bettridge & Son Ltd').first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(/Bettridges Quotation 125 Shakespeare/i).first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Open attachment').first()).toBeVisible({ timeout: 30_000 })
  })
})
