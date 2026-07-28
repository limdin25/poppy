import { test, expect } from './helpers/auth'

/**
 * Per-campaign AI text-reply prompt, in the admin UI.
 *
 * Hugo 2026-07-28: "every campaign should have own reply prompt". Maria's
 * website opener ("this is Pedro, I built you one") was answered with the Google
 * reviews pitch, because until now one global row served every campaign.
 *
 * READ ONLY on purpose. The local dev server talks to the PROD Supabase project,
 * so this spec never saves: it asserts the tab renders, that the seeded
 * "Plumbers - Maria" prompt is on screen and flagged as an override, and that a
 * campaign with no override shows the inherited badge instead. Saving here would
 * write a real prompt onto a real campaign.
 *
 * Needs a CRM admin session:
 *   E2E_OWNER_READY=1 E2E_EMAIL=... E2E_PASSWORD=... npx playwright test tests/e2e/campaign-sms-reply.spec.ts
 */

const MARIA = '70f416fd-f30b-4d32-8c3b-3dbf86ed1fd9' // Plumbers - Maria (the website blast)
const MARR = '297a2f40-e0b7-49cc-b843-b516847d67f4' // Plumbers - Marr (inherits)

const tabUrl = (id: string) =>
  `/admin/crm/settings?scope=campaign&campaignId=${id}&tab=replies`

test.describe('Campaign AI text replies', () => {
  test.skip(process.env.E2E_OWNER_READY !== '1', 'needs a CRM admin account (E2E_OWNER_READY=1)')

  test('the campaign that caused this shows its own Pedro prompt, flagged as an override', async ({
    authedPage: page,
  }) => {
    await page.goto(tabUrl(MARIA))

    const card = page.locator('div.rounded-2xl').filter({ hasText: 'Reply prompt for this campaign' })
    await expect(card).toBeVisible({ timeout: 20_000 })

    const box = card.locator('textarea')
    await expect(box).toBeVisible()
    const value = await box.inputValue()
    expect(value).toContain('You are Pedro')
    expect(value).toContain('Never say you are not Pedro')
    // It must not have picked up the reviews pitch from the workspace default.
    expect(value).not.toContain('£99')

    // ScopeBadge renders "override" next to a reset control, so match the
    // control's title rather than the badge's exact text.
    await expect(card.getByTitle(/Clear override/i)).toBeVisible()
  })

  test('mode is per campaign and this one is on draft, not auto', async ({ authedPage: page }) => {
    await page.goto(tabUrl(MARIA))
    const card = page.locator('div.rounded-2xl').filter({ hasText: 'What happens with the reply' })
    await expect(card).toBeVisible({ timeout: 20_000 })
    await expect(card.getByText(/This campaign is on/i)).toContainText('draft')
    await expect(card.getByRole('button', { name: 'Draft for approval' })).toBeVisible()
    await expect(card.getByRole('button', { name: 'Auto send' })).toBeVisible()
  })

  test('a campaign with no override inherits, and shows the workspace default', async ({
    authedPage: page,
  }) => {
    await page.goto(tabUrl(MARR))
    const card = page.locator('div.rounded-2xl').filter({ hasText: 'Reply prompt for this campaign' })
    await expect(card).toBeVisible({ timeout: 20_000 })

    await expect(card.locator('textarea')).toHaveValue('')
    await expect(card.getByText('inherited', { exact: true }).first()).toBeVisible()
    await expect(card.getByTitle(/Clear override/i)).toHaveCount(0)

    // The workspace default is readable from the same screen.
    await card.locator('summary').click()
    await expect(card).toContainText(/HeyElsie/i)
  })
})
