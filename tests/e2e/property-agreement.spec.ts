import { test, expect } from '@playwright/test'

/**
 * Role-scoped working agreements.
 *
 * /join/property is the Property Deal Sourcing Caller agreement. It is a
 * SIGNATURE-ONLY link: the person signing already works here and already has a
 * CRM login, so it must record the signature and never create or touch an
 * account, and never show the 6-digit code or password steps.
 *
 * /join is the original B2B Sales Closer agreement and must be exactly as it
 * was, so an already-shared link keeps working.
 *
 * Needs the API routes, so run it against a deployment:
 *   E2E_BASE_URL=https://app.heyelsie.com npx playwright test property-agreement
 *
 * Leaves one throwaway signature row (full name "E2E Property Test") against
 * an existing demo profile. Delete it with:
 *   delete from wk_agreement_signatures where full_name = 'E2E Property Test';
 */

// A seeded demo account that already has a profiles row. Using it is the whole
// point: the account-creating flow rejects an email like this with a 409, and
// the signature-only flow must accept it.
const EXISTING_ACCOUNT_EMAIL = 'demo.user@heyelsie.com'

/** Draw on the signature pad. It listens for PointerEvents, so dispatch them. */
async function drawSignature(page: import('@playwright/test').Page) {
  await page.locator('canvas').evaluate((el: HTMLCanvasElement) => {
    const r = el.getBoundingClientRect()
    const pe = (type: string, x: number, y: number, target: EventTarget) =>
      target.dispatchEvent(new PointerEvent(type, { clientX: r.left + x, clientY: r.top + y, bubbles: true }))
    pe('pointerdown', 20, 40, el)
    pe('pointermove', 120, 90, el)
    pe('pointermove', 200, 55, el)
    pe('pointermove', 260, 80, el)
    pe('pointerup', 260, 80, window)
  })
}

test.describe('Property working agreement /join/property', () => {
  test('shows the property terms, not the sales closer ones', async ({ page }) => {
    await page.goto('/join/property')

    await expect(page.getByRole('heading', { name: /working agreement/i })).toBeVisible()
    await expect(page.getByText('Property Deal Sourcing Caller', { exact: true })).toBeVisible()

    const body = page.locator('body')

    // The company on this agreement is Unico, and it names the registered
    // entity Pedro is actually contracting with.
    await expect(page.getByText('Unico', { exact: true })).toBeVisible()
    await expect(body).toContainText('Who you are working with')
    await expect(body).toContainText('ULINC UNICO GROUP LTD')
    await expect(body).toContainText('company number 11197856')
    await expect(body).toContainText('483 Green Lanes, London, England, N13 4BS')
    await expect(body).toContainText('belong to Unico')
    // HeyElsie is the sales closer brand and must not appear on this page.
    await expect(body).not.toContainText('HeyElsie')
    // The pay ladder and the completion clause, the two things a dispute turns on.
    await expect(body).toContainText('What counts as a completed deal')
    await expect(body).toContainText('An accepted offer is NOT a completed deal')
    await expect(body).toContainText('You start on 100 USD per week')
    await expect(body).toContainText('adds 25 USD to your weekly salary')
    await expect(body).toContainText('200 USD per week, which is the maximum')
    await expect(body).toContainText('you earn 100 USD for every deal you complete')
    await expect(body).toContainText('Monday to Friday, 10:00am to 6:00pm UK time')
    await expect(body).toContainText('Idle time does not count as paid working time')
    await expect(body).toContainText('1 to 2 months')

    // Pay day, changed 2026-08-10: released Saturday and sent by Wise. The old
    // clause (72 hours, in practice Monday morning) must be gone from the live
    // page. Note "Monday to Friday" still appears under Your hours, so this
    // asserts on the pay phrase, not the bare word.
    await expect(body).toContainText('your salary is released the next day, every Saturday')
    await expect(body).toContainText('sent to you by Wise')
    await expect(body).toContainText('allow until midnight on Saturday')
    await expect(body).toContainText('set up your Wise details first')
    await expect(body).not.toContainText('Monday morning')
    await expect(body).not.toContainText('within 72 hours')
    await expect(body).not.toContainText('direct debit')

    // None of the B2B sales closer terms may leak in.
    await expect(body).not.toContainText('50% commission')
    await expect(body).not.toContainText('Three strikes')
  })

  test('will not submit without a name and a signature', async ({ page }) => {
    await page.goto('/join/property')
    const signBtn = page.getByRole('button', { name: /sign .* continue/i })

    // No name, no signature.
    await signBtn.click()
    await expect(page.getByText('Please type your full name.')).toBeVisible()

    // Name but still no signature.
    await page.getByPlaceholder('Jane Smith').fill('E2E Property Test')
    await signBtn.click()
    await expect(page.getByText('Please sign in the box.')).toBeVisible()

    // Name + signature opens the acknowledgements, which are the property ones.
    await drawSignature(page)
    await signBtn.click()
    await expect(page.getByRole('heading', { name: /before you sign/i })).toBeVisible()
    await expect(page.locator('body')).toContainText('an accepted offer is not a completed deal')
    const confirmBtn = page.getByRole('button', { name: /complete my signature/i })
    await expect(confirmBtn).toBeDisabled()
  })

  test('records the signature for an email that already has an account, and creates no second account', async ({ page }) => {
    await page.goto('/join/property')

    await page.getByPlaceholder('Jane Smith').fill('E2E Property Test')
    await drawSignature(page)
    await page.getByRole('button', { name: /sign .* continue/i }).click()

    // Every acknowledgement must be ticked.
    await expect(page.getByRole('heading', { name: /before you sign/i })).toBeVisible()
    const confirmBtn = page.getByRole('button', { name: /complete my signature/i })
    await expect(confirmBtn).toBeDisabled()
    for (const box of await page.locator('input[type="checkbox"]').all()) await box.check()
    await expect(confirmBtn).toBeEnabled()
    await confirmBtn.click()

    // Email confirmation step. Signature-only wording, and no password field.
    await expect(page.getByRole('heading', { name: /confirm your email/i })).toBeVisible()
    await expect(page.locator('body')).not.toContainText('This becomes your CRM login')
    await page.getByPlaceholder('you@example.com').fill(EXISTING_ACCOUNT_EMAIL)

    const signed = page.waitForResponse(
      (r) => r.url().includes('/api/agent-onboarding/sign-only') && r.request().method() === 'POST',
    )
    await page.getByRole('button', { name: /submit my signed agreement/i }).click()
    const res = await signed

    // 200, not the 409 the account-creating route gives an existing email, and
    // the server confirms it matched the existing account rather than making one.
    expect(res.status()).toBe(200)
    const payload = await res.json()
    expect(payload.ok).toBe(true)
    expect(payload.hasAccount).toBe(true)
    expect(payload.signatureId).toBeTruthy()

    // Done, with no password or code step anywhere in the journey.
    await expect(page.getByRole('heading', { name: /thank you/i })).toBeVisible({ timeout: 20000 })
    await expect(page.locator('body')).toContainText('signed agreement is saved')
    await expect(page.locator('body')).not.toContainText('the password you just set')
    await expect(page.getByPlaceholder('123456')).toHaveCount(0)

    // The copy they keep must name Unico and the registered entity, not HeyElsie.
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: /download your signed agreement/i }).click()
    const file = await (await download).createReadStream()
    const copy = await new Promise<string>((resolve, reject) => {
      let out = ''
      file.on('data', (c) => { out += c.toString() })
      file.on('end', () => resolve(out))
      file.on('error', reject)
    })
    expect(copy).toContain('Unico')
    expect(copy).toContain('ULINC UNICO GROUP LTD')
    expect(copy).toContain('company number 11197856')
    expect(copy).toContain('E2E Property Test')
    expect(copy).not.toContain('HeyElsie')
    // Same source as the emailed copy, so this covers both.
    expect(copy).toContain('every Saturday')
    expect(copy).toContain('sent to you by Wise')
    expect(copy).not.toContain('Monday morning')
  })

  test('the property link cannot be used to create an account', async ({ request }) => {
    // The account-creating route must refuse a signature-only agreement.
    const viaSignRoute = await request.post('/api/agent-onboarding/sign', {
      data: { slug: 'property', name: 'E2E Property Test', email: EXISTING_ACCOUNT_EMAIL },
    })
    expect(viaSignRoute.status()).toBe(400)
    expect((await viaSignRoute.json()).error).toMatch(/does not create an account/i)

    // And the old guard is still in place on the sales closer agreement: an
    // email that already has a profile is still bounced to the login.
    const salesRoute = await request.post('/api/agent-onboarding/sign', {
      data: { name: 'E2E Property Test', email: EXISTING_ACCOUNT_EMAIL },
    })
    expect(salesRoute.status()).toBe(409)
    expect((await salesRoute.json()).error).toMatch(/already exists/i)
  })

  test('the config API serves it as Unico, signature only', async ({ request }) => {
    const res = await request.get('/api/agent-onboarding/config?slug=property')
    expect(res.status()).toBe(200)
    const j = await res.json()
    expect(j.ok).toBe(true)
    expect(j.agreement.company).toBe('Unico')
    expect(j.agreement.mode).toBe('sign_only')
    expect(JSON.stringify(j.agreement.terms)).toContain('ULINC UNICO GROUP LTD')
    expect(JSON.stringify(j.agreement)).not.toContain('HeyElsie')
    // Pay terms live here and nowhere else, so the page, the printable copy and
    // the confirmation email all move together.
    const pay = j.agreement.terms.find((t: { heading: string }) => t.heading === 'When you get paid')
    expect(pay.body).toContain('every Saturday')
    expect(pay.body).toContain('sent to you by Wise')
    expect(pay.body).toContain('allow until midnight on Saturday')
    expect(pay.body).not.toContain('Monday')
    expect(pay.body).not.toContain('72 hours')
  })

  test('an unknown role slug is a dead link, not a blank agreement', async ({ page }) => {
    await page.goto('/join/not-a-real-role')
    await expect(page.getByRole('heading', { name: /this link is not active/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /sign .* continue/i })).toHaveCount(0)
  })
})

test.describe('The original /join is unchanged', () => {
  test('still serves the B2B Sales Closer agreement and its account flow', async ({ page }) => {
    await page.goto('/join')

    await expect(page.getByRole('heading', { name: /working agreement/i })).toBeVisible()
    const body = page.locator('body')
    await expect(body).toContainText('B2B Sales Closer')
    await expect(body).toContainText('50% commission')
    await expect(body).toContainText('Three strikes and we may end your role')

    // None of the property terms may appear here, and neither may the Unico
    // trading name or its registered entity: this agreement is HeyElsie.
    await expect(body).not.toContainText('What counts as a completed deal')
    await expect(body).not.toContainText('Property Deal Sourcing Caller')
    await expect(body).not.toContainText('Unico')
    await expect(body).not.toContainText('ULINC')

    // Same acknowledgements it has always had.
    await page.getByPlaceholder('Jane Smith').fill('E2E Sales Read Only')
    await drawSignature(page)
    await page.getByRole('button', { name: /sign .* continue/i }).click()
    await expect(page.getByRole('heading', { name: /before you sign/i })).toBeVisible()
    await expect(body).toContainText('three strikes can end my role')
    for (const box of await page.locator('input[type="checkbox"]').all()) await box.check()
    await page.getByRole('button', { name: /complete my signature/i }).click()

    // Still the account-creating email step, wording untouched. Stops here so
    // the run leaves no signup row behind.
    await expect(page.getByRole('heading', { name: /your email/i })).toBeVisible()
    await expect(body).toContainText('This becomes your CRM login')
    await expect(page.getByRole('button', { name: /send code/i })).toBeVisible()
  })

  test('the config API with no slug still returns the sales closer agreement', async ({ request }) => {
    const res = await request.get('/api/agent-onboarding/config')
    expect(res.status()).toBe(200)
    const j = await res.json()
    expect(j.ok).toBe(true)
    expect(j.agreement.slug).toBe('sales-closer')
    expect(j.agreement.mode).toBe('account')
    expect(j.agreement.company).toBe('HeyElsie')
    expect(JSON.stringify(j.agreement.terms)).toContain('50% commission')
    expect(JSON.stringify(j.agreement)).not.toContain('Unico')
    // The property pay change must not have leaked across. This agreement keeps
    // its own wording: 72 hours, in practice Monday morning, and no Wise.
    const pay = j.agreement.terms.find((t: { heading: string }) => t.heading === 'When you get paid')
    expect(pay.body).toContain('within 72 hours')
    expect(pay.body).toContain('Monday morning')
    expect(pay.body).not.toContain('Wise')
    expect(pay.body).not.toContain('Saturday')
  })
})
