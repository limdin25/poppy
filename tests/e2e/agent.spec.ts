import { test, expect } from './helpers/auth'
import { heal, existsHealed } from './helpers/healer'

/**
 * AI Agent — K-009.
 *
 * Covers the four sub-pages reached from the AI Agent left sub-nav:
 *   - /agents/personality (AI Personality — Easy/Advanced fields)
 *   - /agents/classification (now labelled "Goals", not "Classification")
 *   - /agents/followup (Auto Follow-up — enable toggle + delay + messages)
 *   - /agents/handoff (Human Handoff — keyword/condition fields + Save)
 *
 * SAFETY: runs against the live shared demo account. These tests assert presence
 * and labels ONLY. We MAY type into a field then move on, but we NEVER click any
 * "Save changes" / "Save follow-up sequence" / "Save handoff settings" button —
 * doing so would mutate the shared agent. Toggling segmented Easy/Advanced and
 * switching nav items is reversible UI-only navigation and is fine.
 *
 * If the demo account has no agent yet, the pages render a "Set up your AI agent"
 * empty state; affected tests skip in that case rather than fail.
 */

/** True if the page is showing the no-agent empty state instead of settings. */
async function isNoAgent(page: import('@playwright/test').Page): Promise<boolean> {
  return existsHealed(page, { text: /Set up your AI agent/i, describe: 'no-agent empty state' })
}

test.describe('AI Agent', () => {
  // ── A) Personality ──────────────────────────────────────────────────────
  test('left sub-nav shows the four agent sections (and says "Goals")', async ({ authedPage }) => {
    await authedPage.goto('/agents/personality')
    await expect(authedPage.locator('body')).toContainText(/AI agent/i, { timeout: 15_000 })

    // Scope to the AGENT page's own left sub-nav (the card containing the
    // "Search agent settings" box), not the global app sidebar. The app sidebar
    // STILL renders a stale "Classification" sub-link (Layout.tsx:59 lags the
    // AgentLayout rename to "Goals") — see appBugs. We assert the agent sub-nav,
    // which is what this test is actually about, and verify it has been renamed.
    const subNav = authedPage.locator('nav', {
      has: authedPage.getByRole('textbox', { name: /Search agent settings/i }),
    })
    await expect(subNav).toBeVisible({ timeout: 10_000 })

    await expect(subNav.getByRole('link', { name: /AI Personality/i })).toBeVisible()
    // Nav item is "Goals", NOT "Classification".
    await expect(subNav.getByRole('link', { name: /Goals/i })).toBeVisible()
    await expect(subNav.getByRole('link', { name: /Auto Follow-up/i })).toBeVisible()
    await expect(subNav.getByRole('link', { name: /Human Handoff/i })).toBeVisible()

    // The word "Classification" must NOT appear in the agent sub-nav.
    await expect(subNav.getByRole('link', { name: /Classification/i })).toHaveCount(0)
  })

  test('personality page has Easy Setup / Advanced toggle + Assistant name + Welcome message', async ({ authedPage }) => {
    await authedPage.goto('/agents/personality')
    if (await isNoAgent(authedPage)) { test.skip(true, 'demo account has no agent — empty state shown'); return }

    expect(await existsHealed(authedPage, { role: { type: 'button', name: /Easy Setup/i } })).toBe(true)
    expect(await existsHealed(authedPage, { role: { type: 'button', name: /^Advanced$/i } })).toBe(true)

    // Easy mode is the default — Assistant name + Welcome message fields show.
    expect(await existsHealed(authedPage, { label: /Assistant name/i, placeholder: /Elsie/i })).toBe(true)
    expect(await existsHealed(authedPage, { label: /Welcome message/i })).toBe(true)
  })

  test('personality "Refine with AI" button exists', async ({ authedPage }) => {
    await authedPage.goto('/agents/personality')
    if (await isNoAgent(authedPage)) { test.skip(true, 'demo account has no agent — empty state shown'); return }
    expect(await existsHealed(authedPage, { role: { type: 'button', name: /Refine with AI/i }, text: /Refine with AI/i })).toBe(true)
  })

  test('personality Easy mode exposes Tone, Available days, Opens/Closes, Location, pre-appointment, cancellation', async ({ authedPage }) => {
    await authedPage.goto('/agents/personality')
    if (await isNoAgent(authedPage)) { test.skip(true, 'demo account has no agent — empty state shown'); return }

    expect(await existsHealed(authedPage, { label: /Tone of voice/i })).toBe(true)
    expect(await existsHealed(authedPage, { text: /Available days/i })).toBe(true)
    expect(await existsHealed(authedPage, { label: /^Opens$/i })).toBe(true)
    expect(await existsHealed(authedPage, { label: /^Closes$/i })).toBe(true)
    expect(await existsHealed(authedPage, { label: /Location \/ address/i })).toBe(true)
    expect(await existsHealed(authedPage, { label: /Pre-appointment instructions/i })).toBe(true)
    expect(await existsHealed(authedPage, { label: /Cancellation policy/i })).toBe(true)
  })

  test('personality has a Services list with an Add control', async ({ authedPage }) => {
    await authedPage.goto('/agents/personality')
    if (await isNoAgent(authedPage)) { test.skip(true, 'demo account has no agent — empty state shown'); return }

    // The "Services" label + the new-service input placeholder from the source.
    expect(await existsHealed(authedPage, { text: /^Services$/i })).toBe(true)
    expect(await existsHealed(authedPage, { placeholder: /Deep clean/i })).toBe(true)
    // The "Add" button next to the new-service input.
    expect(await existsHealed(authedPage, { role: { type: 'button', name: /^Add$/i } })).toBe(true)
  })

  test('personality typing into Assistant name does not require saving', async ({ authedPage }) => {
    await authedPage.goto('/agents/personality')
    if (await isNoAgent(authedPage)) { test.skip(true, 'demo account has no agent — empty state shown'); return }

    // Allowed: type into a field. NOT allowed: clicking Save (would mutate shared agent).
    const nameField = await heal(authedPage, { label: /Assistant name/i, placeholder: /Elsie/i })
    await nameField.fill('Elsie QA (not saved)')
    await expect(nameField).toHaveValue('Elsie QA (not saved)')
    // Deliberately do NOT click "Save changes".
  })

  test('personality Advanced mode reveals System Prompt + Welcome Message', async ({ authedPage }) => {
    await authedPage.goto('/agents/personality')
    if (await isNoAgent(authedPage)) { test.skip(true, 'demo account has no agent — empty state shown'); return }

    await (await heal(authedPage, { role: { type: 'button', name: /^Advanced$/i } })).click()
    expect(await existsHealed(authedPage, { label: /System Prompt/i })).toBe(true)
    expect(await existsHealed(authedPage, { text: /Welcome Message/i })).toBe(true)
    expect(await existsHealed(authedPage, { text: /Start from a Template/i })).toBe(true)
  })

  // ── B) Goals (formerly Classification) ──────────────────────────────────
  test('goals page heading is "Goals" and avoids Hot/Warm/Cold wording', async ({ authedPage }) => {
    await authedPage.goto('/agents/classification')
    if (await isNoAgent(authedPage)) { test.skip(true, 'demo account has no agent — empty state shown'); return }

    expect(await existsHealed(authedPage, { role: { type: 'heading', name: /^Goals$/i }, text: /^Goals$/ })).toBe(true)

    // Description should describe optimisation goals, not the old Hot/Warm/Cold tiers.
    const desc = authedPage.getByText(/optimise/i).first()
    await expect(desc).toBeVisible()
    await expect(authedPage.getByText(/Hot.*Warm.*Cold/i)).toHaveCount(0)
  })

  test('goals page shows the four presets + a Custom goal tile', async ({ authedPage }) => {
    await authedPage.goto('/agents/classification')
    if (await isNoAgent(authedPage)) { test.skip(true, 'demo account has no agent — empty state shown'); return }

    expect(await existsHealed(authedPage, { text: /Sales Pipeline/i })).toBe(true)
    expect(await existsHealed(authedPage, { text: /Book Intent/i })).toBe(true)
    expect(await existsHealed(authedPage, { text: /General Priority/i })).toBe(true)
    expect(await existsHealed(authedPage, { text: /^Support$/i })).toBe(true)
    expect(await existsHealed(authedPage, { text: /Custom goal/i })).toBe(true)
  })

  test('goals Custom goal tile reveals a custom-goal name field (no save)', async ({ authedPage }) => {
    await authedPage.goto('/agents/classification')
    if (await isNoAgent(authedPage)) { test.skip(true, 'demo account has no agent — empty state shown'); return }

    // The goal-preset tiles live inside a container that is disabled
    // (pointer-events-none) while "goal scoring" is OFF — which is the demo's
    // default state. Enabling it first is reversible UI (we never Save), and is
    // required before the Custom goal tile is clickable.
    const enableToggle = authedPage.getByRole('switch', { name: /Enable goal scoring/i })
    if (await enableToggle.count()) {
      if ((await enableToggle.getAttribute('aria-checked')) !== 'true') {
        await enableToggle.click()
        await expect(enableToggle).toHaveAttribute('aria-checked', 'true')
      }
    }

    await (await heal(authedPage, { role: { type: 'button', name: /Custom goal/i }, text: /Custom goal/i })).click()
    expect(await existsHealed(authedPage, { label: /Custom goal name/i, placeholder: /Renewal pipeline/i })).toBe(true)
    // Reversible UI reveal only — do NOT click "Save changes".
  })

  // ── C) Auto Follow-up ───────────────────────────────────────────────────
  test('followup page has an enable toggle, delay control, and message template', async ({ authedPage }) => {
    await authedPage.goto('/agents/followup')
    if (await isNoAgent(authedPage)) { test.skip(true, 'demo account has no agent — empty state shown'); return }

    await expect(authedPage.locator('body')).toContainText(/Automatic follow-up/i, { timeout: 15_000 })

    // Enable toggle (Switch renders an accessible control labelled "Enable auto follow-up").
    expect(
      await existsHealed(authedPage, {
        role: { type: 'switch', name: /Enable auto follow-up/i },
        text: /Enable auto follow-up/i,
        describe: 'enable auto follow-up toggle',
      }),
    ).toBe(true)

    // Delay control — the per-step "If no reply, send N day(s)" number input.
    expect(await existsHealed(authedPage, { text: /If no reply, send/i })).toBe(true)
    expect(
      await existsHealed(authedPage, { css: 'input[type="number"]', describe: 'follow-up delay (days) input' }),
    ).toBe(true)

    // Template / message selector — each step has a message Textarea.
    expect(
      await existsHealed(authedPage, { placeholder: /Message Elsie sends/i, describe: 'follow-up message template' }),
    ).toBe(true)
  })

  // ── D) Human Handoff ────────────────────────────────────────────────────
  test('handoff page has keyword/condition fields and a Save button', async ({ authedPage }) => {
    await authedPage.goto('/agents/handoff')
    if (await isNoAgent(authedPage)) { test.skip(true, 'demo account has no agent — empty state shown'); return }

    await expect(authedPage.locator('body')).toContainText(/handoff/i, { timeout: 15_000 })

    // Keyword/condition fields.
    expect(await existsHealed(authedPage, { label: /Handoff keywords/i, placeholder: /complaint, refund/i })).toBe(true)
    expect(await existsHealed(authedPage, { label: /Handoff message to customer/i })).toBe(true)
    // Timing condition (delay select).
    expect(await existsHealed(authedPage, { label: /Hand off to me after/i })).toBe(true)

    // Save control EXISTS (presence only — we never click it on the shared agent).
    expect(await existsHealed(authedPage, { role: { type: 'button', name: /Save handoff settings/i } })).toBe(true)
  })

  test('handoff escalation triggers toggle is present', async ({ authedPage }) => {
    await authedPage.goto('/agents/handoff')
    if (await isNoAgent(authedPage)) { test.skip(true, 'demo account has no agent — empty state shown'); return }

    expect(await existsHealed(authedPage, { text: /Escalation triggers/i })).toBe(true)
    expect(
      await existsHealed(authedPage, {
        role: { type: 'switch', name: /Enable handoff detection/i },
        text: /Enable handoff detection/i,
        describe: 'handoff detection toggle',
      }),
    ).toBe(true)
  })
})
