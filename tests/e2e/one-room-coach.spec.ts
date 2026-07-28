import { test, expect } from './helpers/auth'

/**
 * One room + softphone everywhere + LIVE coach in the room.
 *
 * Hugo 2026-07-22: consolidate to a single call room (the /dialer-pro room).
 *   1. The floating softphone launcher must appear on EVERY CRM page —
 *      including the dialer-pro page (it used to be hidden there) — so an
 *      agent can free-dial from anywhere.
 *   2. The real LIVE AI coach (the "Live transcript + AI coach" pane, not the
 *      old static objection list) now lives INSIDE the one room as a "Coach"
 *      tab in the right panel, bound to the live call.
 *
 * Needs a CRM admin login (E2E_OWNER_READY=1 + E2E_EMAIL/E2E_PASSWORD).
 */
test.describe('One room — softphone everywhere + live coach tab', () => {
  test.skip(process.env.E2E_OWNER_READY !== '1', 'needs a CRM admin account (E2E_OWNER_READY=1)')

  test('softphone launcher shows ON the dialer-pro page', async ({ authedPage: page }) => {
    await page.goto('/admin/crm/dialer-pro')
    // The dialer room itself renders.
    await expect(page.getByText('Sales script', { exact: true })).toBeVisible({ timeout: 20000 })
    // The floating softphone launcher (free-dial from anywhere) is present here.
    // Idle launcher renders as a pill labelled "Softphone".
    await expect(page.getByText('Softphone', { exact: true })).toBeVisible({ timeout: 10000 })
  })

  test('softphone launcher shows on a NON-dialer page too (Inbox)', async ({ authedPage: page }) => {
    await page.goto('/admin/crm/inbox')
    await expect(page.getByText('Softphone', { exact: true })).toBeVisible({ timeout: 15000 })
  })

  test('the one room has a Coach tab that opens the live transcript + AI coach', async ({ authedPage: page }) => {
    await page.goto('/admin/crm/dialer-pro')
    await expect(page.getByText('Sales script', { exact: true })).toBeVisible({ timeout: 20000 })

    // Right panel now has a Coach tab.
    const coachTab = page.getByRole('button', { name: /^Coach$/ })
    await expect(coachTab).toBeVisible({ timeout: 10000 })
    await coachTab.click()

    // The live coach pane (the same one Hugo pointed at) renders its two
    // always-present headers — NOT the old static objection list.
    await expect(page.getByText('Live transcript + AI coach')).toBeVisible()
    await expect(page.getByText('AI coach — read this aloud')).toBeVisible()

    // Live transcript is COLLAPSED by default — its body is not rendered until
    // the agent expands the drawer (Hugo 2026-07-22).
    await expect(page.getByText(/Live transcript will appear here/i)).toHaveCount(0)
    await page.getByRole('button', { name: /Live transcript/i }).click()
    await expect(page.getByText(/Live transcript will appear here/i)).toBeVisible()
  })
})
