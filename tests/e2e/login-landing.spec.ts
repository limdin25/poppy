import { test, expect, type Page } from '@playwright/test'

/**
 * Where each account lands after signing in.
 *
 * Hugo, 2026-08-10: "when login he should land here .../dialer-pro?script=property_call.
 * Simple as that." Pedro Houses does one job, ringing estate agents, and he was
 * landing in the inbox and then, one sidebar click later, in the PLUMBER dialer:
 * wrong script, wrong pitch, wrong leads, and a live AI coach quoting HeyElsie
 * review prices at an estate agent, because wk_calls.script_key is set from the
 * same query string the sidebar link does not carry.
 *
 * The fix is one nullable column, profiles.landing_path, read by
 * resolveDestination() in LoginPage.tsx. It is NULL for every other account.
 *
 * THE DIALER PAGE ITSELF IS NOT TOUCHED. The bare /admin/crm/dialer-pro is
 * still the plumber room for everybody, exactly as it was. The only thing that
 * moved is where the login form sends one person.
 *
 * Passwords are NOT in this file (repo rule: env vars only), so each test skips
 * unless it is given one. To run it for real against production:
 *
 *   E2E_BASE_URL=https://app.heyelsie.com \
 *   E2E_PEDRO_PASSWORD='...' \
 *   E2E_CONTROL_EMAIL='...' E2E_CONTROL_PASSWORD='...' \
 *   npx playwright test tests/e2e/login-landing.spec.ts --project=chromium
 *
 * The permanent, always-runs guard is tests/login-landing.test.ts, which pins
 * the redirect logic and the migration so neither can quietly widen.
 */

// The login flow itself, so start logged out rather than reusing the setup
// project's saved storageState.
test.use({ storageState: { cookies: [], origins: [] } })

const APP = process.env.E2E_BASE_URL || 'https://app.heyelsie.com'

/** Pedro Houses, the property caller. The only profile with a landing_path. */
const PEDRO_EMAIL = process.env.E2E_PEDRO_EMAIL || 'pedro@unicohost.com'
const PEDRO_PASSWORD = process.env.E2E_PEDRO_PASSWORD || ''

/**
 * Any CRM account whose landing_path is NULL. This is the one that protects
 * Marr: same role, same CRM, no landing_path, so resolveDestination has to fall
 * through to exactly the value it returned before the column existed.
 *
 * Marr (servidormarkyboy@gmail.com) and Pedro's closer login
 * (preyes1588@gmail.com) cannot be used here: both are banned in Supabase Auth
 * (banned_until 2126-07-10) and cannot sign in at all, which is also why
 * login-routing.spec.ts has been failing. Nothing here banned them and nothing
 * here should unban them.
 */
const CONTROL_EMAIL = process.env.E2E_CONTROL_EMAIL || ''
const CONTROL_PASSWORD = process.env.E2E_CONTROL_PASSWORD || ''

/**
 * These are live working accounts, not test accounts, and Pedro is on the
 * phones. Block every write and the softphone token, so opening his room cannot
 * change a lead, a queue row or the coach's facts, and cannot register a second
 * Twilio device under his identity.
 *
 * Auth (/auth/v1/*) and reads (GET, plus /rest/v1/rpc/, which is how the Houses
 * pane loads) stay allowed, or the page under test would not be Pedro's page.
 */
async function readOnly(page: Page) {
  await page.route('**/rest/v1/**', (route) => {
    const req = route.request()
    const isRead = req.method() === 'GET' || req.method() === 'HEAD'
    const isRpc = req.url().includes('/rest/v1/rpc/')
    return isRead || isRpc ? route.continue() : route.abort()
  })
  await page.route('**/functions/v1/wk-voice-token', (route) => route.abort())
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto(`${APP}/login`)
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.locator('button[type="submit"]').click()
}

test('Pedro Houses lands straight in the property call room, no bookmark needed', async ({ page }) => {
  test.skip(!PEDRO_PASSWORD, 'needs E2E_PEDRO_PASSWORD')
  await readOnly(page)
  // Park the draggable Power Dialer card out of the way so the screenshot shows
  // the script and the tabs rather than a call card sitting on top of them.
  // This is the same localStorage key the card itself persists to, in a throwaway
  // browser context, so it changes nothing for Pedro.
  await page.addInitScript(() => {
    localStorage.setItem('dialer_pro_card_pos_v2', JSON.stringify({ x: 12, y: 470 }))
  })
  await signIn(page, PEDRO_EMAIL, PEDRO_PASSWORD)

  // The whole ask: the room, with the script query string already on it.
  await page.waitForURL(/\/admin\/crm\/dialer-pro\?script=property_call/, { timeout: 30_000 })
  expect(page.url()).toContain('/admin/crm/dialer-pro?script=property_call')

  // And it really is the property room, not just a URL that reads right.
  // COL 2 is the estate-agent script.
  await expect(page.getByText('Property call · estate agent')).toBeVisible({ timeout: 30_000 })

  // COL 3 swaps to the property tabs. The two plumber tools are the tell: the
  // Gap calculator sells websites and Objections answers plumber objections.
  await expect(page.getByRole('button', { name: 'Houses', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Coach', exact: true })).toBeVisible()
  // Not exact: the Messages tab carries a message-count badge in its label.
  await expect(page.getByRole('button', { name: /^Messages/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Calculator', exact: true })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Objections', exact: true })).toBeHidden()

  // Let the real queue land before the screenshot, or the proof shows an empty
  // room that has simply not finished loading. Soft, so an empty queue one day
  // is not a failed test.
  // The count, not the words: COL 1 says "No leads in queue" while it is still
  // loading, which matches too early and screenshots an empty room.
  await page.getByText(/^\d+ leads in queue$/).waitFor({ timeout: 20_000 }).catch(() => {})
  await page.screenshot({ path: 'playwright-report/pedro-landing.png' })
})

test('a CRM account with no landing_path still lands in the inbox, unchanged', async ({ page }) => {
  test.skip(!CONTROL_PASSWORD, 'needs E2E_CONTROL_EMAIL / E2E_CONTROL_PASSWORD')
  await readOnly(page)
  await signIn(page, CONTROL_EMAIL, CONTROL_PASSWORD)

  await page.waitForURL(/\/admin\/crm\//, { timeout: 30_000 })
  expect(page.url()).toContain('/admin/crm/inbox')
  // Never the dialer, and never the property script.
  expect(page.url()).not.toContain('dialer-pro')
  expect(page.url()).not.toContain('property_call')
})
