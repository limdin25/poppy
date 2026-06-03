import { test, expect } from './helpers/auth'
import { heal, existsHealed } from './helpers/healer'
import type { Page } from '@playwright/test'

/**
 * Inbox — K-002 coverage.
 *
 * The Inbox is a two-pane view: a chat list (FilterChips folders) on the left and a
 * thread on the right. The thread's footer toolbar carries the deal/AI/follow-up/notes
 * controls. These tests assert the controls EXIST and OPEN/CLOSE without crashing.
 *
 * SAFETY: this runs against the live shared demo account. We NEVER send messages,
 * approve/rewrite AI drafts, or schedule follow-ups. We only switch tabs, open panels,
 * and close them again.
 */

const FOLDER_LABELS = ['Inbox', 'Unread', 'Assigned to me', 'Assigned to team', 'Archived', 'Closed']

/** Open the first conversation in the list (if any). Returns true when a thread opened. */
async function openFirstConversation(page: Page): Promise<boolean> {
  await page.goto('/inbox')
  // Chat cards are role="button" rows in the left list. The composer placeholder is the
  // reliable signal that a thread opened.
  const card = page.locator('aside [role="button"]').first()
  if ((await card.count()) === 0) return false
  await card.click().catch(() => {})
  return existsHealed(page, { placeholder: /type a message/i, describe: 'composer' }, { timeout: 6000 })
}

test.describe('Inbox', () => {
  test('loads with the chat list and folder header', async ({ authedPage }) => {
    await authedPage.goto('/inbox')
    // The folder name doubles as the list heading; "Inbox" is the default folder.
    await expect(authedPage.locator('body')).toContainText(/Inbox/i, { timeout: 15_000 })
    expect(authedPage.url()).toContain('/inbox')
  })

  // K-002 (a): all six filter tabs exist and clicking each filters without crashing.
  test('K-002a: all six filter tabs exist and switch without crashing', async ({ authedPage }) => {
    await authedPage.goto('/inbox')
    const errors: string[] = []
    authedPage.on('pageerror', (e) => errors.push(String(e)))

    for (const label of FOLDER_LABELS) {
      const tab = await heal(authedPage, {
        role: { type: 'button', name: new RegExp(`^${label}`, 'i') },
        text: new RegExp(label, 'i'),
        describe: `${label} folder tab`,
      })
      await expect(tab).toBeVisible()
      await tab.click()
      // App chrome still present after the filter switch (no crash / redirect).
      await expect(authedPage.locator('nav a[href*="inbox"]').first()).toBeVisible()
      expect(authedPage.url()).not.toMatch(/\/login|\/welcome/)
    }
    expect(errors, `runtime errors while switching folders:\n${errors.join('\n')}`).toEqual([])
  })

  // K-002 (b): there must be NO "+ Deal" button in the conversation header.
  test('K-002b: no "+ Deal" button in the conversation header', async ({ authedPage }) => {
    const opened = await openFirstConversation(authedPage)
    test.skip(!opened, 'No conversations on demo account to inspect the header [data-dependent]')

    const dealBtn = await existsHealed(authedPage, {
      role: { type: 'button', name: /\+?\s*deal/i },
      text: /\+\s*deal/i,
      describe: '+ Deal button',
    })
    expect(dealBtn, 'a "+ Deal" button should NOT exist in the thread header').toBe(false)
  })

  // K-002 (c): footer toolbar carries AI control, status dropdown, Follow-up, deal-value, Notes.
  test('K-002c: footer toolbar has AI / status / Follow-up / deal-value / Notes controls', async ({ authedPage }) => {
    const opened = await openFirstConversation(authedPage)
    test.skip(!opened, 'No conversations on demo account to inspect the footer [data-dependent]')

    // AI on/off control
    expect(
      await existsHealed(authedPage, { role: { type: 'button', name: /AI (on|off)/i }, text: /AI (on|off)/i, describe: 'AI on/off' }),
    ).toBe(true)
    // Status dropdown (pipeline stage select)
    expect(
      await existsHealed(authedPage, { css: 'select[title="Status / pipeline stage"]', role: { type: 'combobox' }, describe: 'status dropdown' }),
    ).toBe(true)
    // Follow-up button
    expect(
      await existsHealed(authedPage, { role: { type: 'button', name: /follow-?up/i }, text: /follow-?up/i, describe: 'Follow-up button' }),
    ).toBe(true)
    // Deal-value control (preferred testid)
    expect(await existsHealed(authedPage, { testid: 'deal-value-trigger', describe: 'deal value trigger' })).toBe(true)
    // Notes button (preferred testid)
    expect(await existsHealed(authedPage, { testid: 'notes-btn', describe: 'notes button' })).toBe(true)
  })

  // K-002 (d): opening a conversation shows the message thread.
  test('K-002d: opening a conversation shows the message thread', async ({ authedPage }) => {
    const opened = await openFirstConversation(authedPage)
    test.skip(!opened, 'No conversations on demo account to open a thread [data-dependent]')

    // Composer is present (proves a thread, not the empty state).
    await expect(await heal(authedPage, { placeholder: /type a message/i, describe: 'composer' })).toBeVisible()
    // Either message bubbles, the "No messages yet" empty state, or a loading spinner — never a crash.
    const hasThreadContent = await existsHealed(authedPage, { text: /No messages yet|via WhatsApp|via Email|via SMS|via Call/i, describe: 'thread content' })
    expect(hasThreadContent).toBe(true)
  })

  // K-002 (d, cont.): if an AI draft exists, Edit turns it into an editable textarea (Save/Cancel); then Cancel.
  test('K-002d: AI draft Edit toggles inline editor then Cancel (if a draft exists)', async ({ authedPage }) => {
    const opened = await openFirstConversation(authedPage)
    test.skip(!opened, 'No conversations on demo account [data-dependent]')

    const hasDraft = await existsHealed(authedPage, { text: /Elsie drafted a reply/i, describe: 'AI draft banner' })
    test.skip(!hasDraft, 'No pending AI draft on the first conversation to edit [data-dependent]')

    // Click Edit → textarea + Save/Cancel appear.
    await (await heal(authedPage, { role: { type: 'button', name: /^edit$/i }, text: /^edit$/i, describe: 'Edit draft' })).click()
    await expect(await heal(authedPage, { role: { type: 'button', name: /^save$/i }, text: /^save$/i, describe: 'Save draft' })).toBeVisible()
    const cancel = await heal(authedPage, { role: { type: 'button', name: /^cancel$/i }, text: /^cancel$/i, describe: 'Cancel draft edit' })
    await expect(cancel).toBeVisible()
    // Cancel — DO NOT save or approve. Back to the read-only draft.
    await cancel.click()
    await expect(authedPage.locator('body')).toContainText(/Elsie drafted a reply/i)
  })

  // K-002 (e): Assign button opens a dropdown.
  test('K-002e: Assign button opens a dropdown', async ({ authedPage }) => {
    const opened = await openFirstConversation(authedPage)
    test.skip(!opened, 'No conversations on demo account [data-dependent]')

    await (await heal(authedPage, {
      css: 'button[title="Assign conversation"]',
      role: { type: 'button', name: /assign/i },
      describe: 'Assign button',
    })).click()
    // Dropdown shows the "Unassigned" reset option (always rendered).
    expect(await existsHealed(authedPage, { text: /Unassigned|Invite teammates/i, describe: 'assign dropdown' })).toBe(true)
    // Close by pressing Escape / clicking away.
    await authedPage.keyboard.press('Escape').catch(() => {})
  })

  // K-002 (f): Follow-up opens the panel with editable step text + timing; close it.
  test('K-002f: Follow-up opens panel with editable step + timing, then close', async ({ authedPage }) => {
    const opened = await openFirstConversation(authedPage)
    test.skip(!opened, 'No conversations on demo account [data-dependent]')

    await (await heal(authedPage, { role: { type: 'button', name: /follow-?up/i }, text: /follow-?up/i, describe: 'Follow-up toggle' })).click()
    // Panel header.
    await expect(await heal(authedPage, { text: /Follow-ups for/i, describe: 'follow-up panel' })).toBeVisible()
    // Editable message text area for a step.
    expect(
      await existsHealed(authedPage, { placeholder: /use \{name\}|Message/i, css: 'textarea', describe: 'step message field' }),
    ).toBe(true)
    // Timing select ("Send if no reply within" / delay options).
    await expect(authedPage.locator('body')).toContainText(/Send if no reply within|Then after/i)
    // Close the panel (X button inside it).
    await authedPage.locator('button:has(svg)').filter({ hasText: '' }).first().waitFor({ state: 'attached' }).catch(() => {})
    // Toggling Follow-up again closes the panel.
    await (await heal(authedPage, { role: { type: 'button', name: /follow-?up/i }, text: /follow-?up/i, describe: 'Follow-up toggle' })).click()
    await expect(authedPage.locator('body')).not.toContainText(/Follow-ups for/i, { timeout: 4000 })
  })

  // K-002 (g): quick-reply (lightning) button opens a picker.
  test('K-002g: quick-reply (lightning) button opens the picker', async ({ authedPage }) => {
    const opened = await openFirstConversation(authedPage)
    test.skip(!opened, 'No conversations on demo account [data-dependent]')

    await (await heal(authedPage, {
      css: 'button[title="Insert quick reply"]',
      describe: 'quick-reply lightning button',
    })).click()
    // Picker header / empty-state text confirms it opened.
    expect(
      await existsHealed(authedPage, { text: /Quick replies|No quick replies yet/i, describe: 'quick-reply picker' }),
    ).toBe(true)
    // Close it without inserting/sending anything.
    await (await heal(authedPage, { role: { type: 'button', name: /^close$/i }, text: /^close$/i, describe: 'close picker' })).click().catch(() => {})
  })

  // Notes button opens the notes panel (reversible UI-only). Part of footer toolbar (K-002c).
  test('Notes button opens the notes panel and closes', async ({ authedPage }) => {
    const opened = await openFirstConversation(authedPage)
    test.skip(!opened, 'No conversations on demo account [data-dependent]')

    await (await heal(authedPage, { testid: 'notes-btn', text: /notes/i, describe: 'Notes button' })).click()
    // Notes textarea appears (do not save).
    expect(await existsHealed(authedPage, { testid: 'notes-input', css: 'textarea', describe: 'notes input' })).toBe(true)
    // Toggle Notes again to close.
    await (await heal(authedPage, { testid: 'notes-btn', text: /notes/i, describe: 'Notes button' })).click()
  })

  // Status dropdown is a real select with options (does not auto-change the deal here — we only read).
  test('K-002c: status dropdown is a select with pipeline stage options', async ({ authedPage }) => {
    const opened = await openFirstConversation(authedPage)
    test.skip(!opened, 'No conversations on demo account [data-dependent]')

    const statusSelect = await heal(authedPage, { css: 'select[title="Status / pipeline stage"]', role: { type: 'combobox' }, describe: 'status select' })
    await expect(statusSelect).toBeVisible()
    // It should carry at least one selectable option.
    const optionCount = await statusSelect.locator('option').count()
    expect(optionCount).toBeGreaterThan(0)
  })
})
