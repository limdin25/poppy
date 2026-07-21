import { test, expect } from './helpers/auth'

/**
 * "Use it like a human" pass over the whole CRM: every main page must render
 * its real content (not a blank / spinner / crash). Runs against prod with a
 * CRM admin account (E2E_OWNER_READY=1 + E2E_EMAIL/E2E_PASSWORD).
 *
 * The page-specific `marker` is visible text unique to that page, so a passing
 * assertion means the page mounted AND rendered its content. If a page threw
 * during render, the CRM shell would blank and the marker would never appear.
 *
 * Not covered (can't run headless): live outbound voice via the browser Twilio
 * SDK, and SMS to UK mobiles (no SMS-capable UK number wired; US toll-free
 * can't text UK). See the session report.
 */
test.describe('CRM — every page renders (human sweep)', () => {
  test.skip(process.env.E2E_OWNER_READY !== '1', 'needs a CRM admin account (E2E_OWNER_READY=1)')

  const PAGES: Array<{ path: string; marker: RegExp | string }> = [
    { path: '/admin/crm/dialer-pro', marker: 'Sales script' },
    { path: '/admin/crm/inbox', marker: /whatsapp/i },
    { path: '/admin/crm/pipelines', marker: 'Pipelines' },
    { path: '/admin/crm/contacts', marker: /New contact/i },
    { path: '/admin/crm/broadcasts', marker: /New broadcast/i },
    { path: '/admin/crm/reports', marker: 'Reports' },
    { path: '/admin/crm/leaderboard', marker: /Calls made/i },
    { path: '/admin/crm/calls', marker: 'Call history' },
    { path: '/admin/crm/templates', marker: 'Templates' },
    { path: '/admin/crm/dashboard', marker: /Maya|receptionist/i },
    { path: '/admin/crm/agent', marker: /personality|voice|Maya|SMS/i },
    { path: '/admin/crm/settings', marker: /WORKSPACE DEFAULTS/i },
  ]

  for (const { path, marker } of PAGES) {
    test(`renders ${path}`, async ({ authedPage: page }) => {
      await page.goto(path)
      // The CRM shell mounted = the guard passed and the layout didn't throw.
      await expect(page.locator('[data-feature="SMSV2__LAYOUT"]')).toBeVisible({ timeout: 20000 })
      // Page-specific visible content rendered (not a blank / spinner / crash).
      await expect(page.locator('body')).toContainText(marker, { timeout: 20000 })
    })
  }
})
