import { test, expect } from '@playwright/test'

/**
 * Integrations directory e2e (go.heyelsie.com /integrations).
 * Self-contained: signs in with the seeded reviews demo client, then checks the
 * nav position (Social Posting → Integrations → Refer a Friend), the directory
 * cards/statuses, and the live webhook URL section.
 *
 * Defaults to prod; point REVIEWS_E2E_GO_URL at http://go.localhost:5174 for a
 * local render pass (webhook test skips — /api only exists on Vercel).
 * Run standalone with --no-deps (skips the app-host auth setup).
 */

const GO = process.env.REVIEWS_E2E_GO_URL || 'https://go.heyelsie.com'
const EMAIL = process.env.REVIEWS_E2E_EMAIL || 'reviews-demo@heyelsie-qa.com'
const PASSWORD = process.env.REVIEWS_E2E_PASSWORD || 'ReviewsDemo2026!'
const IS_LOCAL = GO.includes('localhost')

test.use({ storageState: { cookies: [], origins: [] } })
test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ page }) => {
  await page.goto(`${GO}/login`)
  await page.getByPlaceholder('Email').fill(EMAIL)
  await page.getByPlaceholder('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  // Signed in once the app shell renders its nav (attached, not visible — the
  // aside is display:none on the mobile project)
  await page.locator('aside nav a').first().waitFor({ state: 'attached', timeout: 20_000 })
})

test('nav places Integrations between Social Posting and Refer a Friend', async ({ page }) => {
  const labels = (await page.locator('aside nav a').allTextContents()).map((t) => t.trim())
  const social = labels.indexOf('Social Posting')
  const integrations = labels.indexOf('Integrations')
  const referrals = labels.indexOf('Refer a Friend')
  expect(social, 'nav has Social Posting').toBeGreaterThanOrEqual(0)
  expect(integrations, 'nav has Integrations').toBeGreaterThan(social)
  expect(referrals, 'nav has Refer a Friend after Integrations').toBeGreaterThan(integrations)
})

test('directory renders every integration with its verified status', async ({ page }) => {
  await page.goto(`${GO}/integrations`)
  await expect(page.getByRole('heading', { name: 'Integrations', level: 1 })).toBeVisible()

  for (const name of ['ServiceM8', 'simPRO', 'Joblogic', 'Jobber', 'Commusoft', 'Tradify', 'Powered Now', 'CleanManager', 'GoCardless', 'QuickBooks', 'Xero', 'Spreadsheet upload']) {
    await expect(page.getByRole('heading', { name, level: 3 })).toBeVisible()
  }

  // Verified-API platforms are marked coming soon
  await expect(page.getByTestId('integration-servicem8').getByText('Coming soon')).toBeVisible()

  // Tradify has no public API — the workaround must point at Xero/QuickBooks
  const tradify = page.getByTestId('integration-tradify')
  await expect(tradify.getByText('No direct API')).toBeVisible()
  await expect(tradify.getByText(/Xero\/QuickBooks/)).toBeVisible()

  // The one always-live card links through to the upload page
  const csv = page.getByTestId('integration-csv')
  await expect(csv.getByText('Available')).toBeVisible()
  await expect(csv.getByRole('link', { name: 'Upload customers' })).toHaveAttribute('href', '/add-contacts')
})

test('webhook section shows the business trigger URL', async ({ page }) => {
  test.skip(IS_LOCAL, '/api routes only exist on the deployed app')
  await page.goto(`${GO}/integrations`)
  const input = page.getByTestId('webhook-url')
  await expect(input).toBeVisible({ timeout: 20_000 })
  await expect(input).toHaveValue(/\/api\/reviews\/trigger\?token=.+/)
})
