import { test, expect } from './helpers/auth'
import type { Locator } from '@playwright/test'

/**
 * CRM inbox — unread on top, pin, archive, drafts filter (Hugo 2026-07-28).
 *
 * SAFETY: nothing here sends a message, approves a draft, or touches a lead.
 * Pin and archive write only to wk_inbox_state, which is per-agent view state,
 * and every test puts back what it changed.
 */

const rows = (page: import('@playwright/test').Page): Locator =>
  page.locator('[data-testid^="inbox-row-"]')

/**
 * The sidebar loads twice: an unscoped first pass, then a narrower one once
 * useCrmAuth has resolved whether this user is an admin (~2s). Sampling in
 * between compares two different lists. Wait for the count to hold still.
 */
async function settle(page: import('@playwright/test').Page) {
  let last = -1
  for (let i = 0; i < 25; i++) {
    await page.waitForTimeout(700)
    const n = await rows(page).count()
    if (n === last && i > 1) return
    last = n
  }
}

async function gotoInbox(page: import('@playwright/test').Page) {
  await page.goto('/admin/crm/inbox')
  await expect(page.getByTestId('inbox-filter-all')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('inbox-filter-all').click()
  await settle(page)
}

test.describe('CRM inbox — unread / pin / archive', () => {
  test.skip(process.env.E2E_OWNER_READY !== '1', 'needs an admin account (E2E_OWNER_READY=1)')

  test('the new filter pills exist and switch without crashing', async ({ authedPage: page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await gotoInbox(page)

    for (const f of ['unread', 'drafts', 'archived']) {
      const pill = page.getByTestId(`inbox-filter-${f}`)
      await expect(pill).toBeVisible()
      await pill.click()
      await settle(page)
      // Still the inbox, no redirect, no blank screen.
      await expect(page.getByTestId('inbox-filter-all')).toBeVisible()
    }
    // Pre-existing noise, not ours: useSpendGuard / useCurrentAgent /
    // useFollowups all re-register postgres_changes after subscribe(). Verified
    // 2026-07-28 that no such error names the inbox channels. Anything else is
    // a real crash and must fail this test.
    const real = errors.filter((e) => !/cannot add `postgres_changes` callbacks/.test(e))
    expect(real, `runtime errors while switching filters:\n${real.join('\n')}`).toEqual([])
  })

  test('every row under DRAFTS has an AI reply waiting', async ({ authedPage: page }) => {
    await gotoInbox(page)
    await page.getByTestId('inbox-filter-drafts').click()
    await settle(page)

    const n = await rows(page).count()
    if (n === 0) {
      await expect(page.locator('aside').first()).toContainText(/No AI replies waiting/i)
      return
    }
    for (let i = 0; i < n; i++) {
      const id = (await rows(page).nth(i).getAttribute('data-testid'))!.replace('inbox-row-', '')
      await expect(page.getByTestId(`inbox-draft-pending-${id}`)).toBeVisible()
    }
  })

  test('unread rows sort above read ones, however new the read ones are', async ({ authedPage: page }) => {
    await gotoInbox(page)
    const flags = await rows(page).evaluateAll((els) =>
      els.map((el) => ({
        unread: el.getAttribute('data-unread') === '1',
        pinned: el.getAttribute('data-pinned') === '1',
      })),
    )
    test.skip(flags.length === 0, 'no conversations on this account [data-dependent]')

    // Bands must appear in order: pinned, then unread, then the rest. Once a
    // read row has been seen, no unread row may follow it.
    const band = (f: { unread: boolean; pinned: boolean }) => (f.pinned ? 0 : f.unread ? 1 : 2)
    const bands = flags.map(band)
    expect(bands, `sidebar order was ${bands.join(',')}`).toEqual([...bands].sort((a, b) => a - b))
  })

  test('unread rows carry a count badge; UNREAD filter shows exactly them', async ({ authedPage: page }) => {
    await gotoInbox(page)
    const unreadIds: string[] = await rows(page).evaluateAll((els) =>
      els
        .filter((el) => el.getAttribute('data-unread') === '1')
        .map((el) => (el.getAttribute('data-testid') ?? '').replace('inbox-row-', '')),
    )
    test.skip(unreadIds.length === 0, 'nothing unread on this account [data-dependent]')

    await expect(page.getByTestId(`inbox-unread-${unreadIds[0]}`)).toBeVisible()

    await page.getByTestId('inbox-filter-unread').click()
    await settle(page)
    const shown = await rows(page).evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-testid') ?? '').replace('inbox-row-', '')),
    )
    expect(new Set(shown)).toEqual(new Set(unreadIds))
  })

  test('pin moves a row to the top, unpin puts it back', async ({ authedPage: page }) => {
    await gotoInbox(page)
    const ids = await rows(page).evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-testid') ?? '').replace('inbox-row-', '')),
    )
    test.skip(ids.length < 2, 'needs at least two conversations [data-dependent]')

    // Pin the LAST visible row — the one recency would never put first.
    const target = ids[ids.length - 1]
    await page.getByTestId(`inbox-pin-${target}`).click()
    await settle(page)

    const firstId = (await rows(page).first().getAttribute('data-testid'))!.replace('inbox-row-', '')
    expect(firstId).toBe(target)
    await expect(page.getByTestId(`inbox-pinned-${target}`)).toBeVisible()

    // Put it back exactly as it was.
    await page.getByTestId(`inbox-pin-${target}`).click()
    await settle(page)
    await expect(page.getByTestId(`inbox-row-${target}`)).toHaveAttribute('data-pinned', '0')
  })

  test('archive hides a row from ALL and shows it under ARCHIVED, restore undoes it', async ({ authedPage: page }) => {
    await gotoInbox(page)
    const ids = await rows(page).evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-testid') ?? '').replace('inbox-row-', '')),
    )
    test.skip(ids.length < 2, 'needs at least two conversations [data-dependent]')

    const target = ids[ids.length - 1]
    await page.getByTestId(`inbox-archive-${target}`).click()
    await expect(page.getByTestId(`inbox-row-${target}`)).toHaveCount(0)

    await page.getByTestId('inbox-filter-archived').click()
    await expect(page.getByTestId(`inbox-row-${target}`)).toBeVisible({ timeout: 15_000 })

    // Restore, then confirm it is back in ALL.
    await page.getByTestId(`inbox-archive-${target}`).click()
    await settle(page)
    await page.getByTestId('inbox-filter-all').click()
    await settle(page)
    await expect(page.getByTestId(`inbox-row-${target}`)).toBeVisible()
  })
})
