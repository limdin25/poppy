import { test, expect } from './helpers/auth'
import { existsHealed, clickHealed } from './helpers/healer'

/**
 * Overview / Dashboard — checklist K-001 (a..g).
 *
 * Verifies the dashboard renders real, sane data: pipeline-stage status badges
 * (not Hot/Warm/Cold), a working "Next 6 hours" panel, lead avatars, four numeric
 * stat cards, the channel breakdown, the conversations chart + 7/30 toggle, and
 * that the section action links route to /inbox, /appointments and /knowledge.
 *
 * Runs against the LIVE production app on the shared demo account — read-only:
 * we only switch the chart range toggle and follow navigation links.
 */

test.describe('Overview / Dashboard', () => {
  // --- (d) 4 stat cards present with numeric values (not NaN) ---
  test('four stat cards are present', async ({ authedPage }) => {
    await authedPage.goto('/dashboard')
    for (const label of [
      /Conversations answered/i,
      /Avg response time/i,
      /Hot leads/i,
      /Drafts pending/i,
    ]) {
      expect(await existsHealed(authedPage, { text: label }), `stat card "${label}" missing`).toBeTruthy()
    }
  })

  test('stat card values are numeric / valid — never NaN', async ({ authedPage }) => {
    await authedPage.goto('/dashboard')
    // Wait for the stat grid to settle past the "—" loading placeholders.
    await authedPage.waitForTimeout(2500)
    // The big-number values live in the stat cards; none may read "NaN".
    await expect(authedPage.locator('body')).not.toContainText('NaN')
    // The StatCard root (rounded-2xl card) holds BOTH the "Conversations answered"
    // label *and* the big number in a sibling <p>; the inner label div alone has no
    // value, so scope to the card root and assert it resolves to a digit or em-dash.
    const convCard = authedPage.locator('.rounded-2xl').filter({ hasText: /Conversations answered/i }).first()
    await expect(convCard).toContainText(/\d|—/)
  })

  // --- (a) "Needs your reply" status badges show pipeline stages, NOT Hot/Warm/Cold ---
  test('"Needs your reply" panel renders with pipeline-stage badges (no Hot/Warm/Cold)', async ({ authedPage }) => {
    await authedPage.goto('/dashboard')
    expect(await existsHealed(authedPage, { text: /Needs your reply/i })).toBeTruthy()
    // Wait for conversations to load (loading → list or empty state).
    await authedPage.waitForTimeout(2500)

    // Scope to the SectionCard ROOT (the .rounded-2xl card holds both the eyebrow
    // and the <ul>); the inner eyebrow div alone has no list, so .last() on plain
    // <div> grabbed the wrong node and saw zero rows.
    const panel = authedPage.locator('.rounded-2xl').filter({ hasText: /Needs your reply/i }).first()
    // Either a real list, or the clean "all caught up" empty state — never a crash.
    const hasContent =
      (await panel.getByRole('listitem').count()) > 0 ||
      (await existsHealed(authedPage, { text: /caught up|no conversations waiting/i }))
    expect(hasContent, 'Needs your reply panel showed neither rows nor empty state').toBeTruthy()

    // The OLD lead-temperature taxonomy must NOT appear as a status badge.
    // (Stage badges use names like Lead In / Contacted / Meeting Scheduled.)
    const badgeText = await panel.locator('span.rounded-full').allInnerTexts().catch(() => [])
    for (const t of badgeText) {
      expect(t.trim(), `forbidden temperature badge "${t}"`).not.toMatch(/^(Hot|Warm|Cold)$/i)
    }
  })

  // --- (c) lead avatars render (img or initials, not broken) ---
  test('lead avatars render as image or initials', async ({ authedPage }) => {
    await authedPage.goto('/dashboard')
    await authedPage.waitForTimeout(2500)

    const empty = await existsHealed(authedPage, { text: /caught up|no conversations waiting/i })
    if (empty) {
      test.info().annotations.push({ type: 'note', description: 'demo inbox empty — no avatars to assert' })
      return
    }
    // Scope to the SectionCard root (see note above) so the listitems resolve.
    const panel = authedPage.locator('.rounded-2xl').filter({ hasText: /Needs your reply/i }).first()
    const firstRow = panel.getByRole('listitem').first()
    await expect(firstRow).toBeVisible()
    // Avatar is the leading round element: either an <img> or an initials <span>.
    const avatar = firstRow.locator('.rounded-full').first()
    await expect(avatar).toBeVisible()
  })

  // --- (b) "Next 6 hours" panel: appointments + follow-ups OR clean empty state ---
  test('"Next 6 hours" panel renders (list or clean empty state, no crash)', async ({ authedPage }) => {
    await authedPage.goto('/dashboard')
    expect(await existsHealed(authedPage, { text: /Next 6 hours/i })).toBeTruthy()
    await authedPage.waitForTimeout(2500)

    const panel = authedPage.locator('div', { hasText: /Next 6 hours/i }).last()
    const hasContent =
      (await panel.getByRole('listitem').count()) > 0 ||
      (await existsHealed(authedPage, { text: /Nothing booked in the next few hours/i }))
    expect(hasContent, 'Next 6 hours showed neither items nor empty state').toBeTruthy()
  })

  // --- (e) channel breakdown / "where conversations come from" present ---
  test('channel breakdown ("Where conversations come from") is present with WhatsApp', async ({ authedPage }) => {
    await authedPage.goto('/dashboard')
    expect(await existsHealed(authedPage, { text: /Where conversations come from/i })).toBeTruthy()
    expect(await existsHealed(authedPage, { text: /WhatsApp/i })).toBeTruthy()
  })

  // --- (f) "Conversations handled" chart + 7/30-day toggle ---
  test('"Conversations handled" chart and Overview heading are present', async ({ authedPage }) => {
    await authedPage.goto('/dashboard')
    expect(await existsHealed(authedPage, { text: /Conversations handled/i })).toBeTruthy()
    expect(await existsHealed(authedPage, { text: /^Overview$/ })).toBeTruthy()
    // Either bars rendered, or the clean "no messages" empty state.
    await authedPage.waitForTimeout(2500)
    const hasChart =
      (await existsHealed(authedPage, { text: /Messages in and out/i })) ||
      (await existsHealed(authedPage, { text: /No messages in this period yet/i }))
    expect(hasChart).toBeTruthy()
  })

  test('chart 7/30-day toggle is present and switchable', async ({ authedPage }) => {
    await authedPage.goto('/dashboard')
    expect(await existsHealed(authedPage, { text: /7 days/i })).toBeTruthy()
    expect(await existsHealed(authedPage, { text: /30 days/i })).toBeTruthy()
    // Reversible UI-only action: flip to 30 days, then back to 7.
    await clickHealed(authedPage, { role: { type: 'button', name: /30 days/i }, text: /30 days/i })
    await authedPage.waitForTimeout(800)
    await expect(authedPage.locator('body')).not.toContainText('NaN')
    await clickHealed(authedPage, { role: { type: 'button', name: /7 days/i }, text: /7 days/i })
  })

  // --- (g) section links route correctly ---
  test('"Open inbox" link navigates to /inbox', async ({ authedPage }) => {
    await authedPage.goto('/dashboard')
    await clickHealed(authedPage, { role: { type: 'button', name: /Open inbox/i }, text: /Open inbox/i })
    await authedPage.waitForURL(/\/inbox/, { timeout: 10_000 })
    expect(authedPage.url()).toMatch(/\/inbox/)
  })

  test('"All" link (Next 6 hours) navigates to /appointments', async ({ authedPage }) => {
    await authedPage.goto('/dashboard')
    // The "All →" action sits inside the Next 6 hours SectionCard; scope to the card
    // ROOT (.rounded-2xl) — the inner eyebrow div doesn't contain the action button.
    const panel = authedPage.locator('.rounded-2xl').filter({ hasText: /Next 6 hours/i }).first()
    await panel.getByRole('button', { name: /All/i }).first().click()
    await authedPage.waitForURL(/\/appointments/, { timeout: 10_000 })
    expect(authedPage.url()).toMatch(/\/appointments/)
  })

  test('KB "Manage" link navigates to /knowledge', async ({ authedPage }) => {
    await authedPage.goto('/dashboard')
    await clickHealed(authedPage, { role: { type: 'button', name: /Manage/i }, text: /Manage/i })
    await authedPage.waitForURL(/\/knowledge/, { timeout: 10_000 })
    expect(authedPage.url()).toMatch(/\/knowledge/)
  })

  // --- Live activity panel sanity (bonus, no crash) ---
  test('Live activity panel renders with channel filter', async ({ authedPage }) => {
    await authedPage.goto('/dashboard')
    expect(await existsHealed(authedPage, { text: /Live activity/i })).toBeTruthy()
    await authedPage.waitForTimeout(2000)
    const hasContent =
      (await existsHealed(authedPage, { text: /Elsie|You replied|drafted/i })) ||
      (await existsHealed(authedPage, { text: /No activity on this channel yet/i }))
    expect(hasContent).toBeTruthy()
  })
})
