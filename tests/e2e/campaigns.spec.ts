import { test, expect } from './helpers/auth'
import { heal, existsHealed, clickHealed } from './helpers/healer'

/**
 * Campaigns page — K-006.
 *
 * Covers: the three stat cards render with numbers, the "New campaign" button
 * opens a creation flow (which we open then CLOSE — never schedule/send), the
 * flow exposes name / audience(recipients) / message / channel context, and the
 * campaign list renders (or a clean empty state).
 *
 * SAFETY: this runs against the live shared demo account. We never click
 * "Create campaign", never click any row "Send" button — open + close only.
 */

test.describe('Campaigns', () => {
  test('page loads on /campaigns with the heading', async ({ authedPage }) => {
    await authedPage.goto('/campaigns')
    await expect(authedPage.locator('body')).toContainText(/Campaigns/i, { timeout: 15_000 })
    // Did not bounce to login/welcome.
    expect(authedPage.url()).not.toMatch(/\/login|\/welcome/)
  })

  test('K-006a: stat cards present (Active campaigns, Messages sent, Recipients reached)', async ({ authedPage }) => {
    await authedPage.goto('/campaigns')
    await expect(authedPage.locator('body')).toContainText(/Campaigns/i, { timeout: 15_000 })

    expect(await existsHealed(authedPage, { text: /Active campaigns/i, describe: 'Active campaigns stat' })).toBeTruthy()
    expect(await existsHealed(authedPage, { text: /Messages sent/i, describe: 'Messages sent stat' })).toBeTruthy()
    expect(await existsHealed(authedPage, { text: /Recipients reached/i, describe: 'Recipients reached stat' })).toBeTruthy()
  })

  test('K-006a: stat cards show numeric values', async ({ authedPage }) => {
    await authedPage.goto('/campaigns')
    // Wait for the cards to render (not the loading spinner state).
    await expect(authedPage.getByText(/Active campaigns/i).first()).toBeVisible({ timeout: 15_000 })

    // Each card: tiny label + a big number. Assert the sub-labels are present which
    // only render alongside the big <p> number, and that digits exist in the grid.
    await expect(authedPage.getByText(/Sending right now/i).first()).toBeVisible()
    await expect(authedPage.getByText(/Across all campaigns/i).first()).toBeVisible()
    await expect(authedPage.getByText(/Total audience targeted/i).first()).toBeVisible()

    // The stat grid contains at least one numeric value (e.g. "0").
    const body = await authedPage.locator('body').innerText()
    expect(body).toMatch(/\d/)
  })

  test('K-006b: "New campaign" trigger is visible', async ({ authedPage }) => {
    await authedPage.goto('/campaigns')
    await expect(authedPage.locator('body')).toContainText(/Campaigns/i, { timeout: 15_000 })

    const trigger = await heal(authedPage, {
      role: { type: 'button', name: /New campaign/i },
      text: /New campaign/i,
      describe: 'New campaign button',
    })
    await expect(trigger).toBeVisible()
  })

  test('K-006b/c: "New campaign" opens the creation flow, then closes (no submit)', async ({ authedPage }) => {
    await authedPage.goto('/campaigns')
    await expect(authedPage.locator('body')).toContainText(/Campaigns/i, { timeout: 15_000 })

    await clickHealed(authedPage, {
      role: { type: 'button', name: /New campaign/i },
      text: /New campaign/i,
      describe: 'New campaign button',
    })

    // Modal header — distinct from the page heading.
    await expect(authedPage.getByText('New campaign', { exact: true }).last()).toBeVisible()

    // Close WITHOUT submitting — use the Cancel button.
    await clickHealed(authedPage, {
      role: { type: 'button', name: /^Cancel$/i },
      text: /^Cancel$/,
      describe: 'Cancel button',
    })

    // Modal is gone: the Create campaign action should no longer be visible.
    await expect(authedPage.getByRole('button', { name: /Create campaign/i })).toHaveCount(0)
  })

  test('K-006c: creation flow exposes name / audience / message / create fields', async ({ authedPage }) => {
    await authedPage.goto('/campaigns')
    await expect(authedPage.locator('body')).toContainText(/Campaigns/i, { timeout: 15_000 })

    await clickHealed(authedPage, {
      role: { type: 'button', name: /New campaign/i },
      text: /New campaign/i,
      describe: 'New campaign button',
    })

    // Campaign name input (by placeholder).
    expect(
      await existsHealed(authedPage, {
        label: /Campaign name/i,
        placeholder: /Spring deep-clean offer/i,
        describe: 'Campaign name field',
      }),
    ).toBeTruthy()

    // Audience / recipients selector. It's a native <select> (role=combobox);
    // its <option>s are not "visible" while collapsed, so target the control
    // itself and assert it carries the WhatsApp-scoped audience option.
    const audienceSelect = await heal(authedPage, {
      role: { type: 'combobox' },
      css: 'select',
      describe: 'Audience (recipients) select',
    })
    await expect(audienceSelect).toBeVisible()
    await expect(audienceSelect).toContainText(/All WhatsApp contacts/i)

    // Message body (by placeholder text).
    expect(
      await existsHealed(authedPage, {
        label: /Message/i,
        placeholder: /Hi \{name\}/i,
        describe: 'Message field',
      }),
    ).toBeTruthy()

    // The submit action exists in the flow (presence only — we never click it).
    expect(
      await existsHealed(authedPage, {
        role: { type: 'button', name: /Create campaign/i },
        text: /Create campaign/i,
        describe: 'Create campaign submit',
      }),
    ).toBeTruthy()

    // Clean up: close the modal without submitting.
    await clickHealed(authedPage, {
      role: { type: 'button', name: /^Cancel$/i },
      text: /^Cancel$/,
      describe: 'Cancel button',
    })
  })

  test('K-006c: channel context is WhatsApp (recipients/audience are WhatsApp contacts)', async ({ authedPage }) => {
    await authedPage.goto('/campaigns')
    await expect(authedPage.locator('body')).toContainText(/Campaigns/i, { timeout: 15_000 })

    await clickHealed(authedPage, {
      role: { type: 'button', name: /New campaign/i },
      text: /New campaign/i,
      describe: 'New campaign button',
    })

    // The audience options scope to WhatsApp — the channel is implicit/fixed.
    // Native <select>: its <option> isn't "visible" while collapsed, so assert
    // the control is visible and carries the WhatsApp-scoped option text.
    const audienceSelect = await heal(authedPage, {
      role: { type: 'combobox' },
      css: 'select',
      describe: 'Audience (recipients) select',
    })
    await expect(audienceSelect).toBeVisible()
    await expect(audienceSelect).toContainText(/All WhatsApp contacts/i)

    await clickHealed(authedPage, {
      role: { type: 'button', name: /^Cancel$/i },
      text: /^Cancel$/,
      describe: 'Cancel button',
    })
  })

  test('K-006b: modal closes via Escape key (no submit)', async ({ authedPage }) => {
    await authedPage.goto('/campaigns')
    await expect(authedPage.locator('body')).toContainText(/Campaigns/i, { timeout: 15_000 })

    await clickHealed(authedPage, {
      role: { type: 'button', name: /New campaign/i },
      text: /New campaign/i,
      describe: 'New campaign button',
    })
    await expect(authedPage.getByText('New campaign', { exact: true }).last()).toBeVisible()

    await authedPage.keyboard.press('Escape')
    await expect(authedPage.getByRole('button', { name: /Create campaign/i })).toHaveCount(0)
  })

  test('K-006d: campaign list renders (table rows or a clean empty state)', async ({ authedPage }) => {
    await authedPage.goto('/campaigns')
    await expect(authedPage.locator('body')).toContainText(/Campaigns/i, { timeout: 15_000 })
    // Wait past the loading state.
    await expect(authedPage.getByText(/Loading campaigns/i)).toHaveCount(0, { timeout: 15_000 })

    const hasTable = await existsHealed(authedPage, {
      role: { type: 'table' },
      css: 'table',
      describe: 'campaigns table',
    })
    const hasEmpty = await existsHealed(authedPage, {
      text: /No campaigns yet/i,
      describe: 'empty state',
    })

    expect(hasTable || hasEmpty, 'expected either a campaign table or a clean empty state').toBeTruthy()
  })

  test('K-006d: list shows campaign column headers when populated', async ({ authedPage }) => {
    await authedPage.goto('/campaigns')
    await expect(authedPage.locator('body')).toContainText(/Campaigns/i, { timeout: 15_000 })
    await expect(authedPage.getByText(/Loading campaigns/i)).toHaveCount(0, { timeout: 15_000 })

    const hasTable = await existsHealed(authedPage, { css: 'table', describe: 'campaigns table' })
    if (!hasTable) {
      // Empty account — nothing to assert on the table; the empty-state test covers this.
      expect(await existsHealed(authedPage, { text: /No campaigns yet/i })).toBeTruthy()
      return
    }
    // Headers from DataTable columns.
    await expect(authedPage.getByText(/^Campaign$/).first()).toBeVisible()
    await expect(authedPage.getByText(/^Channel$/).first()).toBeVisible()
    await expect(authedPage.getByText(/Recipients/).first()).toBeVisible()
    await expect(authedPage.getByText(/^Status$/).first()).toBeVisible()
  })

  test('opt-out / throttling reassurance copy is shown', async ({ authedPage }) => {
    await authedPage.goto('/campaigns')
    await expect(authedPage.locator('body')).toContainText(/automatic throttling|opt-?outs|unsubscribed/i, {
      timeout: 15_000,
    })
  })
})
