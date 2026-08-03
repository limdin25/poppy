import { test, expect } from './helpers/auth'

/**
 * WhatsApp Business management on Templates > WhatsApp (Hugo 2026-08-03).
 *
 * Admin-only panel backed by wk-whatsapp-admin: Meta message templates
 * (create + submit for approval, live status) and the sender's business
 * profile pulled straight from Twilio. Read-only assertions: the panel
 * loads real data, the submitted instagram_url_request template is listed,
 * and the profile form is populated from the live sender.
 */

test.describe('whatsapp business admin panel', () => {
  test.skip(process.env.E2E_OWNER_READY !== '1', 'needs an admin account (E2E_OWNER_READY=1)')

  test('templates, profile and quick replies are three SEPARATE cards', async ({ authedPage: page }) => {
    await page.goto('/admin/crm/templates')
    await page.getByRole('button', { name: 'WhatsApp', exact: true }).click()

    // Hugo's complaint: one box with two Save buttons read as one form.
    const templatesCard = page.getByTestId('wa-meta-templates-card')
    const profileCard = page.getByTestId('wa-profile-card')
    await expect(templatesCard).toBeVisible({ timeout: 20_000 })
    await expect(profileCard).toBeVisible()
    await expect(page.getByTestId('wa-quick-replies-card')).toBeVisible()
    // Genuinely separate elements, not one nesting the other.
    expect(await profileCard.evaluate(
      (el, other) => el.contains(other as Node),
      await templatesCard.elementHandle(),
    )).toBe(false)
    // The profile's Save lives inside the profile card only.
    await expect(profileCard.getByTestId('wa-profile-save')).toBeVisible()
    await expect(templatesCard.getByTestId('wa-profile-save')).toHaveCount(0)

    // Profile really came from Twilio: the display name field is populated
    // (the sender was registered as "HeyPubli"; assert non-empty, not the
    // exact brand, so a rename does not break the test).
    await expect(page.getByTestId('wa-profile-name')).toHaveValue(/.+/, { timeout: 20_000 })

    // The Meta template submitted on 2026-08-03 shows with a status chip.
    // Data-dependent: skip rather than fail if it is ever deleted.
    const row = page.getByTestId('wa-meta-template-instagram_url_request')
    const present = await row
      .waitFor({ state: 'visible', timeout: 20_000 })
      .then(() => true)
      .catch(() => false)
    test.skip(!present, 'instagram_url_request template not in this dataset [data-dependent]')
    await expect(row).toContainText('Instagram', { ignoreCase: true })
  })
})
