import { test, expect } from './helpers/auth'
import { heal, existsHealed } from './helpers/healer'

/**
 * Account / Settings + currency — K-011 (parts A + B).
 *
 * Routes (from AccountPage.tsx):
 *   /account/general  -> ProfileSection (Personal Details + Password + Danger Zone)
 *   /account/company  -> CompanySection (Business Details + Currency) + TeamSection
 *   /account          -> redirects to /account/general
 *
 * The currency <select data-testid="currency-select"> offers GBP / USD / EUR
 * (labels from src/core/lib/currency.ts: "British Pound (£)", "US Dollar ($)", "Euro (€)").
 *
 * SAFETY: runs against the live shared demo account.
 *  - Currency: presence/options asserted only. One test changes the dropdown then
 *    changes it straight back within the SAME test and NEVER clicks "Save changes"
 *    and NEVER reloads — so nothing is persisted to the shared business.
 *  - Profile / Company / Team: fields and trigger buttons asserted as present.
 *    No Save is clicked, no invite is sent, no photo is uploaded.
 *  - currency-propagation-across-pages and invite-send are [Kimi-only] skips.
 */

test.describe('Account / Settings + currency', () => {
  // ---- Part A: currency selector on the company (Organization) section ----

  test('company section exposes the currency selector', async ({ authedPage }) => {
    await authedPage.goto('/account/company')
    await expect(authedPage.locator('body')).toContainText(/Business Details/i, { timeout: 15_000 })
    expect(
      await existsHealed(authedPage, {
        testid: 'currency-select',
        role: { type: 'combobox', name: /Currency/i },
        describe: 'currency selector',
      }),
    ).toBe(true)
  })

  test('currency selector lists GBP, USD and EUR options', async ({ authedPage }) => {
    await authedPage.goto('/account/company')
    const select = await heal(authedPage, { testid: 'currency-select', describe: 'currency selector' })

    // Values present.
    for (const value of ['GBP', 'USD', 'EUR']) {
      await expect(select.locator(`option[value="${value}"]`)).toHaveCount(1)
    }
    // Exactly the three supported currencies (no more, no less).
    await expect(select.locator('option')).toHaveCount(3)
    // Human-readable labels render.
    await expect(select).toContainText(/British Pound/i)
    await expect(select).toContainText(/US Dollar/i)
    await expect(select).toContainText(/Euro/i)
  })

  test('changing the currency and changing it back leaves the original selected (no save, no reload)', async ({
    authedPage,
  }) => {
    await authedPage.goto('/account/company')
    const select = await heal(authedPage, { testid: 'currency-select', describe: 'currency selector' })

    // Record the demo account's current currency so we can restore it.
    const original = (await select.inputValue()) || 'GBP'
    const other = original === 'USD' ? 'EUR' : 'USD'

    // Flip to a different currency (UI-only state change).
    await select.selectOption(other)
    await expect(select).toHaveValue(other)

    // Flip straight back — within the same test, no "Save changes", no reload.
    await select.selectOption(original)
    await expect(select).toHaveValue(original)

    // Sanity: the Save trigger exists but we deliberately never click it.
    expect(
      await existsHealed(authedPage, { role: { type: 'button', name: /Save changes/i } }),
    ).toBe(true)
  })

  // ---- Part B: Profile fields ----

  test('profile (General) has Full name field and a Save button', async ({ authedPage }) => {
    await authedPage.goto('/account/general')
    await expect(authedPage.locator('body')).toContainText(/Personal Details/i, { timeout: 15_000 })

    // The <label> isn't wired via htmlFor/id, so getByLabel can't associate it with
    // the input. Fall back to the visible label text, which still proves the field renders.
    expect(
      await existsHealed(authedPage, { label: /Full name/i, text: /Full name/i, describe: 'Full name field' }),
    ).toBe(true)
    expect(
      await existsHealed(authedPage, { role: { type: 'button', name: /Save changes/i } }),
    ).toBe(true)
  })

  test('profile exposes a photo upload control', async ({ authedPage }) => {
    await authedPage.goto('/account/general')
    await expect(authedPage.locator('body')).toContainText(/Personal Details/i, { timeout: 15_000 })

    // Button reads "Upload photo" or "Change photo" depending on whether an avatar is set.
    expect(
      await existsHealed(authedPage, {
        role: { type: 'button', name: /(Upload|Change) photo/i },
        describe: 'profile photo upload control',
      }),
    ).toBe(true)
    // Hidden file input backing it (accept image/*).
    await expect(authedPage.locator('input[type="file"]').first()).toHaveCount(1)
  })

  // ---- Part B: Company fields ----

  test('company has Business name, Website and Address fields', async ({ authedPage }) => {
    await authedPage.goto('/account/company')
    await expect(authedPage.locator('body')).toContainText(/Business Details/i, { timeout: 15_000 })

    // Labels aren't associated via htmlFor/id, so getByLabel returns nothing — fall
    // back to the visible label text, which still proves each field renders.
    expect(
      await existsHealed(authedPage, { label: /Business name/i, text: /Business name/i, describe: 'Business name field' }),
    ).toBe(true)
    expect(
      await existsHealed(authedPage, { label: /^Website$/i, text: /^Website$/i, describe: 'Website field' }),
    ).toBe(true)
    // Address uses an AddressAutocomplete widget under the "Business address" label.
    expect(
      await existsHealed(authedPage, {
        text: /Business address/i,
        describe: 'Business address field',
      }),
    ).toBe(true)
  })

  test('company exposes a logo upload control', async ({ authedPage }) => {
    await authedPage.goto('/account/company')
    await expect(authedPage.locator('body')).toContainText(/Business Details/i, { timeout: 15_000 })
    expect(
      await existsHealed(authedPage, {
        role: { type: 'button', name: /(Upload|Change) logo/i },
        describe: 'logo upload control',
      }),
    ).toBe(true)
  })

  // ---- Part B: Team ----

  test('team section shows an Invite button (presence only)', async ({ authedPage }) => {
    await authedPage.goto('/account/company')
    await expect(authedPage.locator('body')).toContainText(/Team Members/i, { timeout: 15_000 })
    expect(
      await existsHealed(authedPage, { role: { type: 'button', name: /Invite/i } }),
    ).toBe(true)
  })

  test('Invite opens the email form, then closes via Cancel without sending', async ({ authedPage }) => {
    await authedPage.goto('/account/company')
    await expect(authedPage.locator('body')).toContainText(/Team Members/i, { timeout: 15_000 })

    await (await heal(authedPage, { role: { type: 'button', name: /Invite/i } })).click()

    // Invite email field appears (placeholder from TeamSection.tsx).
    const emailField = authedPage.getByPlaceholder(/colleague@business/i)
    await expect(emailField).toBeVisible()

    // Close it — NEVER click "Send invite" on the shared demo account.
    await (await heal(authedPage, { role: { type: 'button', name: /^Cancel$/i } })).click()
    await expect(emailField).toHaveCount(0, { timeout: 5000 })
  })

  // ---- [Kimi-only] follow-ups ----

  // K-011 part C: changing currency and confirming the new symbol propagates to
  // deal values across inbox/pipeline requires a real Save + reload, which would
  // mutate the shared demo business. Verify manually with Kimi.
  test.skip('currency change propagates across pages (deal value symbols) [Kimi-only]', async () => {})

  // Sending a real team invite inserts a pending team_members row on the shared
  // demo account (and may trigger an email). Verify manually with Kimi.
  test.skip('sending a team invite [Kimi-only]', async () => {})
})
