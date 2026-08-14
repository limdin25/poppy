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
    const card = page.getByText(/Zest, Hull/i).first()
    await card.waitFor({ timeout: 30_000 }).catch(() => {})
    test.skip(await card.count() === 0, 'Zest, Hull is no longer on the board')

    // 1. The instruction, on the card itself, before anybody clicks.
    const line = page.getByTestId('brief-line').first()
    await expect(line).toBeVisible({ timeout: 15_000 })
    await expect(line).toContainText(/proof of funds/i)

    // 2. And the person to ask for, where "Name not available" used to be.
    await expect(page.getByText(/Ask for Lucy/i).first()).toBeVisible()
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

    const card = page.getByText(/Zest, Hull/i).first()
    await card.waitFor({ timeout: 30_000 }).catch(() => {})
    test.skip(await card.count() === 0, 'Zest, Hull is no longer on the board')

    // The action row only appears on hover, and Email is its fourth button.
    await card.hover()
    await page.locator('button[title="Email"]').first().click()

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
    await expect(send).toBeDisabled()
    await to.fill('lucy@movewithzest.co.uk')
    await expect(to).toHaveValue('lucy@movewithzest.co.uk')
    await expect(send).toBeDisabled() // still no subject and no body
  })
})
