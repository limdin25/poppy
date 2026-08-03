import { test, expect } from './helpers/auth'

/**
 * Their line, their leads (Hugo 2026-08-03).
 *
 * The WhatsApp sender is Maria's number. A thread that only ever spoke to
 * that number (the Hugo test contact: inbound WhatsApp + admin-sent replies)
 * must be visible when viewing the CRM AS Maria, even though she does not
 * own the contact and never texted it herself. This is the exact hunt Hugo
 * went on across three See-as views before the rule existed.
 *
 * SAFETY: read-only. Sets and clears the See-as localStorage key only.
 */

const MARIA_ID = '2b382f7f-defe-4c7d-b25a-470625a038bb'
const WA_THREAD_CONTACT = 'c0fd9cc5-591a-42f6-bb8f-adbad04fe0f0'

test.describe('line participation', () => {
  test.skip(process.env.E2E_OWNER_READY !== '1', 'needs an admin account (E2E_OWNER_READY=1)')

  test("Maria's view shows the WhatsApp thread that lives on her number", async ({ authedPage: page }) => {
    // Baseline: the thread exists at all (Everyone view). If prod data ever
    // loses it, skip rather than fail on a data change.
    await page.evaluate(() => localStorage.removeItem('crm_view_as'))
    await page.goto('/admin/crm/inbox')
    await expect(page.getByTestId('inbox-filter-whatsapp')).toBeVisible({ timeout: 20_000 })
    await page.getByTestId('inbox-filter-whatsapp').click()
    // waitFor, not isVisible: isVisible() returns IMMEDIATELY (no auto-wait),
    // so it always said false while the list was still loading.
    const everyoneHasIt = await page
      .getByTestId(`inbox-row-${WA_THREAD_CONTACT}`)
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false)
    test.skip(!everyoneHasIt, 'WhatsApp test thread not present in this dataset [data-dependent]')

    // As Maria: same thread, because the conversation rode her line.
    await page.evaluate((id) => {
      localStorage.setItem('crm_view_as', JSON.stringify({ id, name: 'Maria' }))
    }, MARIA_ID)
    await page.goto('/admin/crm/inbox')
    await expect(page.getByTestId('inbox-filter-whatsapp')).toBeVisible({ timeout: 20_000 })
    await page.getByTestId('inbox-filter-whatsapp').click()
    await expect(page.getByTestId(`inbox-row-${WA_THREAD_CONTACT}`)).toBeVisible({ timeout: 20_000 })

    // Leave no See-as behind.
    await page.evaluate(() => localStorage.removeItem('crm_view_as'))
  })
})
