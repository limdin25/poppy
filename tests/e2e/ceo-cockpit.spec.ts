import { test, expect } from './helpers/auth'

/**
 * CEO cockpit (Margarita) — owner-only agent.
 *
 * Test 1 (owner-gate) runs with the default demo (non-admin) account and proves a
 * non-owner is bounced away from /admin — i.e. the cockpit is private.
 *
 * Test 2 (full cockpit) needs an OWNER account (email present in admin_users) AND
 * the agent_cockpit migration applied to the database. Enable it with
 * E2E_OWNER_READY=1 (and an owner login via E2E_EMAIL/E2E_PASSWORD in auth.setup).
 */
test.describe('CEO cockpit', () => {
  test('owner-gate: a non-owner cannot reach the cockpit', async ({ authedPage }) => {
    await authedPage.goto('/admin/ceo')
    // AdminGuard bounces non-admins to /dashboard.
    await expect(authedPage).toHaveURL(/\/dashboard/, { timeout: 15_000 })
  })

  test('owner can open the cockpit and start a task', async ({ authedPage }) => {
    test.skip(process.env.E2E_OWNER_READY !== '1', 'needs an owner account + agent_cockpit migration applied')

    await authedPage.goto('/admin/ceo')

    // The screen renders, owner-only.
    await expect(authedPage.locator('body')).toContainText(/CEO/i)
    // Peace-of-mind visibility: the live heartbeat + schedule panel are present.
    await expect(authedPage.locator('body')).toContainText(/Heartbeat/i)
    await expect(authedPage.locator('body')).toContainText(/Schedule & heartbeat/i)
    // The auto-send safety toggle defaults to OFF.
    await expect(authedPage.getByRole('button', { name: /Auto-send OFF/i })).toBeVisible()

    // Start a task.
    const composer = authedPage.locator('textarea').first()
    await composer.fill('E2E check: what is the current time in Istanbul?')
    await authedPage.getByRole('button', { name: /Start|Send/i }).first().click()

    // It shows up as a task / in the thread.
    await expect(authedPage.locator('body')).toContainText(/E2E check/i, { timeout: 15_000 })
  })
})
