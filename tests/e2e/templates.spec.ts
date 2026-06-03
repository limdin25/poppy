import { test, expect } from './helpers/auth'
import { heal, existsHealed } from './helpers/healer'

/**
 * Templates page — K-008.
 *
 * Covers the two tabs (Quick replies / Follow-ups), the "New template" modal
 * (open + Cancel, never save), the templates list / empty state, and the
 * presence of per-card edit/delete controls.
 *
 * SAFETY: runs against the live shared demo account. No template is ever
 * created, edited, or deleted — modals are opened then dismissed, and edit/
 * delete controls are only asserted as present (never clicked through to a
 * destructive action).
 */

test.describe('Templates', () => {
  test('page loads with header and both tabs', async ({ authedPage }) => {
    await authedPage.goto('/templates')
    await expect(authedPage.locator('body')).toContainText(/Templates/i, { timeout: 15_000 })
    expect(await existsHealed(authedPage, { role: { type: 'button', name: /Quick replies/i } })).toBe(true)
    expect(await existsHealed(authedPage, { role: { type: 'button', name: /Follow-ups/i } })).toBe(true)
  })

  test('Quick replies tab is the default view', async ({ authedPage }) => {
    await authedPage.goto('/templates')
    // The "New template" action only renders on the Quick replies tab.
    expect(
      await existsHealed(authedPage, { role: { type: 'button', name: /New template/i } }),
    ).toBe(true)
  })

  test('switching to Follow-ups tab shows follow-up content', async ({ authedPage }) => {
    await authedPage.goto('/templates')
    await (await heal(authedPage, { role: { type: 'button', name: /Follow-ups/i } })).click()
    // Follow-ups tab has its own "New follow-up" action and copy.
    expect(
      await existsHealed(authedPage, { role: { type: 'button', name: /New follow-up/i } }),
    ).toBe(true)
    await expect(authedPage.locator('body')).toContainText(/follow-up/i)
  })

  test('switching back to Quick replies restores its action', async ({ authedPage }) => {
    await authedPage.goto('/templates')
    await (await heal(authedPage, { role: { type: 'button', name: /Follow-ups/i } })).click()
    await (await heal(authedPage, { role: { type: 'button', name: /Quick replies/i } })).click()
    expect(
      await existsHealed(authedPage, { role: { type: 'button', name: /New template/i } }),
    ).toBe(true)
  })

  test('"New template" opens a modal with Title and Message fields', async ({ authedPage }) => {
    await authedPage.goto('/templates')
    await (await heal(authedPage, { role: { type: 'button', name: /New template/i } })).click()

    // Dialog heading.
    await expect(authedPage.locator('body')).toContainText(/New template/i)
    // Name field (Title) + Message field — by placeholder from the source.
    expect(
      await existsHealed(authedPage, { placeholder: /Opening hours/i, label: /Title/i }),
    ).toBe(true)
    expect(
      await existsHealed(authedPage, { placeholder: /\{name\}/i, label: /Message/i }),
    ).toBe(true)
  })

  test('"New template" modal closes via Cancel without saving', async ({ authedPage }) => {
    await authedPage.goto('/templates')
    await (await heal(authedPage, { role: { type: 'button', name: /New template/i } })).click()
    await expect(authedPage.locator('body')).toContainText(/New template/i)

    // Cancel — never Save.
    await (await heal(authedPage, { role: { type: 'button', name: /^Cancel$/i } })).click()
    await expect(
      authedPage.getByPlaceholder(/Opening hours/i),
    ).toHaveCount(0, { timeout: 5000 })
  })

  test('"New template" modal closes via Escape', async ({ authedPage }) => {
    await authedPage.goto('/templates')
    await (await heal(authedPage, { role: { type: 'button', name: /New template/i } })).click()
    await expect(authedPage.locator('body')).toContainText(/New template/i)
    await authedPage.keyboard.press('Escape')
    await expect(authedPage.getByPlaceholder(/Opening hours/i)).toHaveCount(0, { timeout: 5000 })
  })

  test('templates list renders cards or an empty state', async ({ authedPage }) => {
    await authedPage.goto('/templates')
    // Wait for the page to settle past any loading spinner.
    await expect(authedPage.locator('body')).toContainText(/Templates/i, { timeout: 15_000 })

    const hasEmptyState = await existsHealed(authedPage, { text: /No templates yet/i })
    // A rendered template card shows hover-revealed edit/delete with aria-labels.
    const hasCards = await existsHealed(authedPage, {
      role: { type: 'button', name: /^Edit / },
      describe: 'template edit control',
    })
    expect(hasEmptyState || hasCards, 'neither template cards nor empty state rendered').toBe(true)
  })

  test('a rendered template exposes edit and delete controls (presence only)', async ({ authedPage }) => {
    await authedPage.goto('/templates')
    await expect(authedPage.locator('body')).toContainText(/Templates/i, { timeout: 15_000 })

    if (await existsHealed(authedPage, { text: /No templates yet/i })) {
      test.skip(true, 'no templates on the demo account — nothing to assert controls against')
      return
    }

    // Edit + Delete buttons exist per card (aria-label="Edit {title}" / "Delete {title}").
    // Assert presence ONLY — do NOT click delete (it would remove shared demo data).
    const editCount = await authedPage.getByRole('button', { name: /^Edit / }).count()
    const deleteCount = await authedPage.getByRole('button', { name: /^Delete / }).count()
    expect(editCount, 'expected at least one Edit control').toBeGreaterThan(0)
    expect(deleteCount, 'expected at least one Delete control').toBeGreaterThan(0)
  })

  test('Follow-ups tab renders sequences or its empty state', async ({ authedPage }) => {
    await authedPage.goto('/templates')
    await (await heal(authedPage, { role: { type: 'button', name: /Follow-ups/i } })).click()

    const hasEmpty = await existsHealed(authedPage, { text: /No follow-up types yet/i })
    const hasNew = await existsHealed(authedPage, { role: { type: 'button', name: /New follow-up/i } })
    expect(hasEmpty || hasNew, 'follow-ups tab rendered neither content nor empty state').toBe(true)
  })

  test('"New follow-up" opens a modal with a Name field, closes via Cancel', async ({ authedPage }) => {
    await authedPage.goto('/templates')
    await (await heal(authedPage, { role: { type: 'button', name: /Follow-ups/i } })).click()
    await (await heal(authedPage, { role: { type: 'button', name: /New follow-up/i } })).click()

    await expect(authedPage.locator('body')).toContainText(/New follow-up type/i)
    expect(
      await existsHealed(authedPage, { placeholder: /Gentle nudge/i, label: /Name/i }),
    ).toBe(true)

    // Cancel — never Save.
    await (await heal(authedPage, { role: { type: 'button', name: /^Cancel$/i } })).click()
    await expect(authedPage.getByPlaceholder(/Gentle nudge/i)).toHaveCount(0, { timeout: 5000 })
  })
})
