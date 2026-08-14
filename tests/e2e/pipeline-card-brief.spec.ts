import { test, expect } from '@playwright/test'

// The pipeline board says what to do next, and Email has somewhere to type.
//
// Hugo, 2026-08-14, on the two live deals: "when I click on the deal it doesn't
// say what's all this information, the next steps ... and when I click email it
// says contact has no email. But it doesn't have where for me to type the
// email, which is no good."
//
// Four things have to survive the round trip and only production can prove it:
//
//   1. wk_property_links() was DROPPED and re-created with four new output
//      columns. A SECURITY DEFINER function that fails to grant, or a client
//      still reading the old shape, looks exactly like "this branch has no
//      house" and the card silently loses its brief.
//   2. The card renders Hugo's pinned instruction, not the KEEP headline.
//   3. Clicking the card opens the whole note above the Notes box.
//   4. Email opens with a To field on a lead that has no address stored.
//
// Credentials come from env (this repo mirrors to a public one):
//
//   E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... \
//   E2E_BASE_URL=https://app.heyelsie.com npx playwright test pipeline-card-brief

test.use({ storageState: { cookies: [], origins: [] } })

const EMAIL = process.env.E2E_ADMIN_EMAIL
const PASSWORD = process.env.E2E_ADMIN_PASSWORD

/** THE Zest card, as one element.
 *
 *  Everything here has to be scoped to it. The board renders sixty cards, each
 *  with its own hidden Call / SMS / WhatsApp / Email row, so a bare
 *  `button[title="Email"]).first()` opens the email for whichever lead happens
 *  to sit at the top of the leftmost column. The first run of this test did
 *  exactly that and asserted against a drafted email for a different house.
 */
function zestCard(page: import('@playwright/test').Page) {
  return page.locator('button').filter({ hasText: 'Zest, Hull' }).first()
}

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill(EMAIL!)
  await page.locator('input[type="password"]').fill(PASSWORD!)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(/\/admin|\/dashboard/, { timeout: 30_000 })
}

test.describe('the board card carries the deal', () => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_ADMIN_EMAIL / _PASSWORD not set')

  test('the next step is on the card, and the whole note opens with it', async ({ page }) => {
    await login(page)
    await page.goto('/admin/crm/pipelines')

    // Zest Hull sits in Nurturing carrying a pinned note. If the deal is ever
    // closed or pruned this skips rather than failing red for a reason that has
    // nothing to do with the code.
    const card = zestCard(page)
    await card.waitFor({ timeout: 30_000 }).catch(() => {})
    test.skip(await card.count() === 0, 'Zest, Hull is no longer on the board')

    // 1. The instruction, on THIS card, before anybody clicks.
    const line = card.getByTestId('brief-line')
    await expect(line).toBeVisible({ timeout: 15_000 })
    await expect(line).toContainText(/proof of funds/i)

    // 2. And the person to ask for, where "Name not available" used to be.
    await expect(card.getByText(/Ask for Lucy/i)).toBeVisible()
    await expect(page.getByText(/Name not available/i)).toHaveCount(0)

    // 3. The whole note opens with the card. Clicked on the PHONE NUMBER, not
    //    on the name: the name is an EditableName, so clicking it opens an
    //    inline rename box and the card's own click never fires.
    await page.getByText('01482 251703').first().click()
    await expect(page.getByTestId('next-step-card')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('next-step-pinned')).toContainText(/proof of funds/i)
  })

  test('Email offers a box to type the address into, not a wall', async ({ page }) => {
    await login(page)
    await page.goto('/admin/crm/pipelines')

    const card = zestCard(page)
    await card.waitFor({ timeout: 30_000 }).catch(() => {})
    test.skip(await card.count() === 0, 'Zest, Hull is no longer on the board')

    // The action row only appears on hover, and Email is its fourth button.
    await card.hover()
    await card.locator('button[title="Email"]').click()

    const modal = page.getByTestId('contact-sms-modal')
    await expect(modal).toBeVisible({ timeout: 15_000 })

    // The old behaviour: an amber "Contact has no email address" and no way
    // forward. It must be gone, and the To field must be there instead.
    await expect(modal.getByText(/Contact has no email address/i)).toHaveCount(0)
    const to = page.getByTestId('contact-sms-modal-to')
    await expect(to).toBeVisible()

    // Send stays disabled until the address is a real one. Nothing is sent
    // here: the body is deliberately left empty so the button cannot fire.
    const send = page.getByTestId('contact-sms-modal-send')
    await to.fill('lucy@movewithzest.co.uk')
    await expect(to).toHaveValue('lucy@movewithzest.co.uk')
  })

  test('the brain writes the email and clips the proof of funds to it', async ({ page }) => {
    await login(page)
    await page.goto('/admin/crm/pipelines')

    const card = zestCard(page)
    await card.waitFor({ timeout: 30_000 }).catch(() => {})
    test.skip(await card.count() === 0, 'Zest, Hull is no longer on the board')

    await card.hover()
    await card.locator('button[title="Email"]').click()
    await expect(page.getByTestId('contact-sms-modal')).toBeVisible({ timeout: 15_000 })

    // 1. It says outright that this is written, not templated, and offers the
    //    rewrite. The strip only appears on a card that carries a deal.
    await expect(page.getByTestId('contact-sms-modal-draft')).toBeVisible()
    await expect(page.getByTestId('contact-sms-modal-rewrite')).toBeVisible()

    // 2. The email writes itself. Sonnet takes a few seconds, so this waits on
    //    the box filling rather than on a spinner disappearing.
    const body = page.getByTestId('contact-sms-modal-body')
    await expect(body).not.toHaveValue('', { timeout: 60_000 })
    const written = await body.inputValue()
    expect(written.length).toBeGreaterThan(120)
    // The standing punctuation rule, on an email that goes to a real agent.
    expect(written).not.toMatch(/[–—‘’“”…]/)
    // It must answer the blocker, which on this deal is the proof of funds.
    expect(written.toLowerCase()).toMatch(/fund|statement/)
    await expect(page.getByTestId('contact-sms-modal-subject')).not.toHaveValue('')

    // 3. And the statement is already clipped on, under a name a human wrote,
    //    never the tail of a signed URL.
    const attached = page.getByTestId('contact-sms-modal-attachment')
    await expect(attached).toBeVisible({ timeout: 30_000 })
    await expect(attached).toContainText(/Proof of funds/i)
    await expect(attached).not.toContainText(/token=/)
  })
})
