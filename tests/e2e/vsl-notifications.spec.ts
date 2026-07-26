import { test, expect } from '@playwright/test'
import { login } from './helpers/auth'

// Where Hugo and each agent SEE the funnel (Hugo 2026-07-26).
//
// The audit that prompted this found half the signals uncaptured, one screen
// showing any of them, and no date/time stamp anywhere. These tests pin the
// four surfaces that answer "where can I see it": the board's conversion strip,
// the per-lead activity drawer, the leaderboard's funnel view, and the bell.
//
// Admin credentials required — the funnel board and leaderboard are staff-only.
//   E2E_EMAIL=... E2E_PASSWORD=... E2E_BASE_URL=https://app.heyelsie.com

const EMAIL = process.env.E2E_EMAIL
const PASSWORD = process.env.E2E_PASSWORD

test.describe('funnel visibility', () => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_EMAIL/E2E_PASSWORD not set (staff-only pages)')

  test.beforeEach(async ({ page }) => {
    await login(page, EMAIL, PASSWORD)
  })

  test('the board shows conversion counts and per-stage timestamps', async ({ page }) => {
    await page.goto('/admin/crm/video-funnel')

    // Counts come from the aggregate RPC, not the 500-row board query — and
    // from the *_at columns, so a paid lead still counts as having opened.
    const strip = page.locator('[data-testid="funnel-summary-strip"]')
    await expect(strip).toBeVisible({ timeout: 20_000 })
    for (const label of ['Sent', 'Tapped', 'Opened', 'Played', '50%', '90%', '100%', 'Clicked £1', 'Paid']) {
      await expect(strip).toContainText(label)
    }

    // Every card carries the moment it reached its stage.
    const firstCard = page.locator('[data-testid^="funnel-activity-"]').first()
    await expect(firstCard).toBeVisible()
  })

  test('a card opens the full timestamped activity for that lead', async ({ page }) => {
    await page.goto('/admin/crm/video-funnel')
    await page.locator('[data-testid^="funnel-activity-"]').first().click()

    const drawer = page.locator('[data-testid="funnel-activity-drawer"]')
    await expect(drawer).toBeVisible()
    // The journey, stage by stage…
    await expect(drawer).toContainText('Journey')
    await expect(drawer).toContainText('Tapped the link')
    await expect(drawer).toContainText('Started the video')
    await expect(drawer).toContainText('Clicked "Start £1 Trial"')
    // …and every raw event. wk_vsl_events has been written since the funnel
    // shipped; this drawer is the first thing that ever read it.
    await expect(drawer).toContainText('Every event')
  })

  test('the leaderboard carries the funnel, without losing the calls view', async ({ page }) => {
    await page.goto('/admin/crm/leaderboard')

    await expect(page.locator('[data-testid="leaderboard-view-calls"]')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('thead')).toContainText('Calls made')

    await page.locator('[data-testid="leaderboard-view-funnel"]').click()
    for (const col of ['Videos sent', 'Tapped', 'Opened', 'Played', '50%', '90%', '100%', 'Clicked £1', 'Paid']) {
      await expect(page.locator('thead')).toContainText(col)
    }

    // Back to calls — the original board must be intact.
    await page.locator('[data-testid="leaderboard-view-calls"]').click()
    await expect(page.locator('thead')).toContainText('Calls made')
    await expect(page.locator('thead')).toContainText('Spend')
  })

  test('the leaderboard scrolls on a phone instead of clipping its last column', async ({ page }) => {
    // The wrapper used to be overflow-hidden, so Spend was already unreachable
    // at phone width with no scrollbar to hint at it.
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/admin/crm/leaderboard')
    await expect(page.locator('[data-testid="leaderboard-view-calls"]')).toBeVisible({ timeout: 20_000 })

    const scrollable = await page
      .locator('table')
      .first()
      .evaluate((el) => {
        const wrap = el.parentElement!
        return {
          overflowX: getComputedStyle(wrap).overflowX,
          canScroll: wrap.scrollWidth > wrap.clientWidth,
        }
      })
    expect(scrollable.overflowX).toBe('auto')
    expect(scrollable.canScroll).toBe(true)
  })

  test('the bell carries funnel activity alongside messages', async ({ page }) => {
    await page.goto('/admin/crm/video-funnel')
    const bell = page.locator('[data-testid="statusbar-bell"]')
    await expect(bell).toBeVisible({ timeout: 20_000 })
    await bell.click()

    const pop = page.locator('[data-testid="statusbar-bell-popover"]')
    await expect(pop).toBeVisible()
    // Renamed from "Recent inbound" — it is no longer messages-only.
    await expect(pop).toContainText('Activity')
    // Opt-in pop-ups, asked for on a click (browsers require a user gesture).
    const enable = page.locator('[data-testid="enable-desktop-popups"]')
    if (await enable.count()) {
      await expect(enable).toContainText('desktop pop-ups')
    }
  })
})
