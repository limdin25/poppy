import { test, expect } from './helpers/auth'
import { heal, existsHealed, clickHealed } from './helpers/healer'
import type { Page } from '@playwright/test'

/**
 * K-004 — Leads, Table view.
 *
 * Verifies the table surface: count badge vs rows, per-row Status dropdown + AI
 * toggle + chat link + delete (confirm then CANCEL — never confirm), the Add Lead
 * modal (open then Cancel — never submit), Export/Import controls, bulk-select
 * checkboxes, and the StickyNote note indicator.
 *
 * SAFETY: this runs against the live shared demo account. No deletes are ever
 * confirmed, no leads are ever added, no CSV is ever imported.
 */

/** Land on /leads in Table view (default), wait for the table to render. */
async function gotoLeadsTable(page: Page): Promise<void> {
  await page.goto('/leads')
  // Make sure we're on the Table tab (it's the default, but be explicit/resilient).
  if (await existsHealed(page, { role: { type: 'button', name: /^Table$/ }, text: /^Table$/ }, { timeout: 2500 })) {
    await clickHealed(page, { role: { type: 'button', name: /^Table$/ }, text: /^Table$/ })
  }
  // Wait for either rows or the empty-state to settle (not the loading spinner).
  await page.waitForLoadState('networkidle').catch(() => {})
}

/** Count the data rows in the leads <table> body (excludes header + empty-state row). */
async function dataRowCount(page: Page): Promise<number> {
  const rows = page.locator('table tbody tr')
  const total = await rows.count()
  if (total === 0) return 0
  // The empty-state renders a single full-width <td> — treat that as zero rows.
  const emptyCell = page.locator('table tbody tr td[colspan]')
  if ((await emptyCell.count()) > 0) return 0
  return total
}

test.describe('Leads — Table view (K-004)', () => {
  test('(a) lead count badge matches visible row count', async ({ authedPage }) => {
    await gotoLeadsTable(authedPage)

    // The header badge reads "<n> leads"; the toolbar line reads "<n> lead(s)".
    const badge = await heal(authedPage, { text: /\d+\s+leads?\b/i, describe: 'lead count badge' })
    const badgeText = (await badge.textContent()) || ''
    const m = badgeText.match(/(\d+)\s+leads?/i)
    expect(m, `could not parse a count from badge "${badgeText}"`).not.toBeNull()
    const badgeCount = Number(m![1])

    const rows = await dataRowCount(authedPage)
    expect(rows, `badge says ${badgeCount} leads but table shows ${rows} rows`).toBe(badgeCount)
  })

  test('(b) per-row Status dropdown exists', async ({ authedPage }) => {
    await gotoLeadsTable(authedPage)
    if ((await dataRowCount(authedPage)) === 0) test.skip(true, 'no leads on demo account')

    // Status column: an inline pill+chevron button reading a stage name or "Set status".
    const statusBtn = page0Status(authedPage)
    await expect(statusBtn.first()).toBeVisible()
  })

  test('(c) per-row AI toggle exists', async ({ authedPage }) => {
    await gotoLeadsTable(authedPage)
    if ((await dataRowCount(authedPage)) === 0) test.skip(true, 'no leads on demo account')

    // AI column renders a Switch + an "On"/"Paused" label per row.
    const aiLabel = authedPage.locator('table tbody tr').first().getByText(/^(On|Paused)$/)
    await expect(aiLabel.first()).toBeVisible()
    // And the switch control itself (role=switch or a clickable toggle).
    const sw = authedPage.locator('table tbody tr').first().locator('[role="switch"], button[role="switch"]')
    expect(await sw.count()).toBeGreaterThan(0)
  })

  test('(d) chat icon per row links to /inbox', async ({ authedPage }) => {
    await gotoLeadsTable(authedPage)
    if ((await dataRowCount(authedPage)) === 0) test.skip(true, 'no leads on demo account')

    const chatBtn = await heal(authedPage, {
      role: { type: 'button', name: /view chat/i },
      css: 'button[title="View chat"]',
      describe: 'row chat icon',
    })
    await expect(chatBtn).toBeVisible()
    await chatBtn.click()
    await authedPage.waitForURL(/\/inbox/, { timeout: 10_000 })
    expect(authedPage.url()).toMatch(/\/inbox/)
  })

  test('(e) delete icon shows a confirm dialog — then CANCEL (never confirm)', async ({ authedPage }) => {
    await gotoLeadsTable(authedPage)
    if ((await dataRowCount(authedPage)) === 0) test.skip(true, 'no leads on demo account')

    const before = await dataRowCount(authedPage)

    // The page uses window.confirm() — intercept and DISMISS it (cancel the delete).
    let confirmSeen = false
    let confirmMsg = ''
    authedPage.on('dialog', (d) => {
      confirmSeen = true
      confirmMsg = d.message()
      void d.dismiss() // CANCEL — never accept, this is a live shared account.
    })

    const delBtn = await heal(authedPage, {
      role: { type: 'button', name: /delete lead/i },
      css: 'button[title="Delete lead"]',
      describe: 'row delete icon',
    })
    await expect(delBtn).toBeVisible()
    await delBtn.click()

    await expect.poll(() => confirmSeen, { timeout: 5000 }).toBe(true)
    expect(confirmMsg).toMatch(/delete this lead/i)

    // Cancelled => nothing was deleted.
    await authedPage.waitForTimeout(500)
    expect(await dataRowCount(authedPage)).toBe(before)
  })

  test('(f) "Add Lead" opens a modal asking phone + status — then Cancel (do NOT submit)', async ({ authedPage }) => {
    await gotoLeadsTable(authedPage)

    const addBtn = await heal(authedPage, {
      role: { type: 'button', name: /add lead/i },
      text: /add lead/i,
      describe: 'Add Lead button',
    })
    await expect(addBtn).toBeVisible()
    await addBtn.click()

    // Modal opens with a header and a Phone (WhatsApp) field.
    await expect(authedPage.getByText(/^Add lead$/i).first()).toBeVisible()
    const phone = await heal(authedPage, {
      placeholder: /\+44/,
      label: /phone/i,
      describe: 'Add Lead phone field',
    })
    await expect(phone).toBeVisible()
    // Status-relevant fields present too (Name). The modal labels are bare <label>
    // text (not programmatically associated), so match the visible "Name" label text
    // scoped to the modal rather than getByLabel.
    expect(
      await existsHealed(authedPage, { text: /^Name$/, describe: 'name field label' }),
    ).toBe(true)

    // Close WITHOUT submitting — never create a real lead.
    await clickHealed(authedPage, { role: { type: 'button', name: /^Cancel$/ }, text: /^Cancel$/, describe: 'Cancel' })
    await expect(authedPage.locator('input[placeholder*="+44"]')).toHaveCount(0)
  })

  test('(g) Export button exists', async ({ authedPage }) => {
    await gotoLeadsTable(authedPage)
    const ok = await existsHealed(authedPage, {
      role: { type: 'button', name: /^Export$/ },
      text: /^Export$/,
      describe: 'Export button',
    })
    expect(ok).toBe(true)
  })

  test('(h) Import CSV control exists', async ({ authedPage }) => {
    await gotoLeadsTable(authedPage)
    const ok = await existsHealed(authedPage, {
      role: { type: 'button', name: /import csv/i },
      text: /import csv/i,
      describe: 'Import CSV button',
    })
    expect(ok).toBe(true)

    // Opening it reveals a CSV file input (then close, no upload).
    await clickHealed(authedPage, { role: { type: 'button', name: /import csv/i }, text: /import csv/i })
    await expect(authedPage.getByText(/Import leads from CSV/i).first()).toBeVisible()
    expect(await authedPage.locator('input[type="file"]').count()).toBeGreaterThan(0)
    await clickHealed(authedPage, { role: { type: 'button', name: /^Close$/ }, text: /^Close$/, describe: 'Close import' })
  })

  test('(i) row checkboxes for bulk select exist and toggle', async ({ authedPage }) => {
    await gotoLeadsTable(authedPage)
    if ((await dataRowCount(authedPage)) === 0) test.skip(true, 'no leads on demo account')

    const rowCheckbox = authedPage.locator('table tbody tr input[type="checkbox"]').first()
    await expect(rowCheckbox).toBeVisible()
    expect(await rowCheckbox.isChecked()).toBe(false)
    await rowCheckbox.check()
    expect(await rowCheckbox.isChecked()).toBe(true)
    await rowCheckbox.uncheck()
    expect(await rowCheckbox.isChecked()).toBe(false)

    // The header "select all" checkbox also exists and toggles every row.
    const headerCheckbox = authedPage.locator('table thead input[type="checkbox"]').first()
    await expect(headerCheckbox).toBeVisible()
    await headerCheckbox.check()
    expect(await rowCheckbox.isChecked()).toBe(true)
    await headerCheckbox.uncheck()
  })

  test('(j) note indicator (StickyNote) shows for leads with notes', async ({ authedPage }) => {
    await gotoLeadsTable(authedPage)
    if ((await dataRowCount(authedPage)) === 0) test.skip(true, 'no leads on demo account')

    // The StickyNote icon is an amber lucide SVG wrapped in a span carrying the note
    // text as its title. It only renders for leads that actually have notes — so its
    // absence is valid (demo data may have none). Assert the table is consistent:
    // every note-indicator span has a non-empty title.
    const noteSpans = authedPage.locator('table tbody tr span[title]')
    const count = await noteSpans.count()
    if (count === 0) {
      test.skip(true, 'no leads with notes on demo account — indicator correctly absent')
    }
    for (let i = 0; i < count; i++) {
      const title = await noteSpans.nth(i).getAttribute('title')
      expect(title && title.trim().length).toBeTruthy()
      // The amber StickyNote svg lives inside the titled span.
      expect(await noteSpans.nth(i).locator('svg').count()).toBeGreaterThan(0)
    }
  })
})

/** First row's Status dropdown trigger (a button containing a stage pill or "Set status"). */
function page0Status(page: Page) {
  // Status is the 2nd data column; its cell holds a button (the PillDropdown trigger).
  return page
    .locator('table tbody tr')
    .first()
    .locator('button')
    .filter({ hasText: /Set status|Lead In|Qualified|Won|Lost|New|Contacted|[A-Za-z]/ })
}
