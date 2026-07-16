import { test, expect } from './helpers/auth'

/**
 * Admin → Phone Validator (/admin/phone-validation).
 *
 * Uploads a small CSV, checks the full numbering-metadata detail view
 * (international format, calling code, carrier), business columns carried
 * through from the CSV, and the Send-to-CRM flow (tagged contacts that
 * Broadcasts can target). Uses NANPA fictional-range numbers (555-01xx) so no
 * real person's number is written to the CRM; the run tags them
 * qa-validator-e2e for cleanup.
 *
 * Needs an OWNER/admin login (E2E_OWNER_READY=1), same gate as admin-numbers.
 */
const CSV = [
  'name,phone,website,address,location',
  'QA Plumber One,+12025550142,http://example.com/qa1,12 Test St,Washington DC',
  'QA Plumber Two,(202) 555-0187,,,',
  'Bad Number,not-a-number,,,',
].join('\n')

test.describe('Admin phone validator', () => {
  test.skip(process.env.E2E_OWNER_READY !== '1', 'needs an admin account (E2E_OWNER_READY=1)')

  test('validates a CSV, shows full numbering metadata, sends to CRM', async ({ authedPage: page }) => {
    await page.goto('/admin/phone-validation')
    await expect(page.locator('body')).toContainText(/Phone Validator/i)

    // Upload the fixture CSV.
    await page.locator('input[type="file"]').setInputFiles({
      name: 'qa-fixture.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(CSV),
    })

    // Summary cards: 3 total, 2 valid.
    await expect(page.locator('body')).toContainText('Total', { timeout: 30_000 })
    const totalCard = page.locator('div', { hasText: /^Total/ }).locator('p.text-2xl').first()
    await expect(totalCard).toHaveText('3')

    // Business name + international format render in the table.
    await expect(page.locator('td', { hasText: 'QA Plumber One' }).first()).toBeVisible()
    await expect(page.locator('td', { hasText: '+1 202 555 0142' }).first()).toBeVisible()

    // The malformed row is flagged.
    await expect(page.locator('tr', { hasText: 'Bad Number' })).toContainText(/Malformed/i)

    // Expand the first valid row → full numbering metadata panel.
    await page.locator('tr', { hasText: 'QA Plumber One' }).first().click()
    const detail = page.locator('dl', { hasText: 'Numbering metadata' })
    await expect(detail).toContainText('International format')
    await expect(detail).toContainText('+1 202 555 0142')
    await expect(detail).toContainText('E.164')
    await expect(detail).toContainText('+12025550142')
    await expect(detail).toContainText('Country calling code')
    await expect(detail).toContainText('United States')
    await expect(detail).toContainText('Metadata carrier')
    await expect(detail).toContainText('Possible length/pattern')
    // Business panel with the website link.
    await expect(page.locator('body')).toContainText('http://example.com/qa1')

    // Send the valid rows to the CRM with a QA tag.
    await page.getByRole('button', { name: /Send 2 to CRM/i }).click()
    await expect(page.locator('body')).toContainText(/Send to CRM contacts/i)
    const tagInput = page.locator('input[value*="validated-"]')
    await tagInput.fill('qa-validator-e2e')
    await page.getByRole('button', { name: /Add 2 contacts/i }).click()

    // Done screen: contacts added + links to Contacts and Broadcasts.
    await expect(page.locator('body')).toContainText(/contacts added/i, { timeout: 30_000 })
    await expect(page.locator('a[href="/admin/crm/contacts"]')).toBeVisible()
    await expect(page.locator('a[href="/admin/crm/broadcasts"]')).toBeVisible()
    await expect(page.locator('body')).toContainText('qa-validator-e2e')
  })
})
