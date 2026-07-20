import { test, expect } from '@playwright/test'

/**
 * HeyElsie Reviews e2e — runs against the DEPLOYED stack (the reviews app
 * lives on go.heyelsie.com; API routes only exist on Vercel).
 * Self-contained: creates its own QA account (…@heyelsie-qa.com) through the
 * real onboarding, then exercises dashboard, contacts, billing, widgets,
 * referrals, checkout-session creation and webhook fail-closed behaviour.
 */

const GO = process.env.REVIEWS_E2E_GO_URL || 'https://go.heyelsie.com'
const APP = process.env.REVIEWS_E2E_APP_URL || 'https://app.heyelsie.com'
const MARKETING = process.env.REVIEWS_E2E_MARKETING_URL || 'https://heyelsie.com'

const RUN_ID = Date.now().toString(36)
const QA_EMAIL = `reviews-e2e-${RUN_ID}@heyelsie-qa.com`
const QA_PASSWORD = `E2e-${RUN_ID}-pass!`
const QA_BUSINESS = `QA Reviews ${RUN_ID}`

// Fresh browser state — these tests must not inherit the receptionist session.
test.use({ storageState: { cookies: [], origins: [] } })
test.describe.configure({ mode: 'serial' })

let accessToken = ''
let businessId = ''

async function grabSession(page: import('@playwright/test').Page) {
  const session = await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!
      if (k.startsWith('sb-') && k.endsWith('-auth-token')) {
        try { return JSON.parse(localStorage.getItem(k)!) } catch { return null }
      }
    }
    return null
  })
  expect(session?.access_token, 'supabase session in localStorage').toBeTruthy()
  accessToken = session.access_token
}

test('marketing landing sells the reviews product with UK pricing', async ({ page }) => {
  await page.goto(`${MARKETING}/`)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('400 reviews')
  await expect(page.getByText('£99', { exact: false }).first()).toBeVisible()
  await expect(page.getByText('£179', { exact: false }).first()).toBeVisible()
  await expect(page.getByText('£279', { exact: false }).first()).toBeVisible()
  await expect(page.getByText('Most popular').first()).toBeVisible()
  // Signup CTAs hand off to the go. subdomain
  const cta = page.getByRole('link', { name: /Start getting reviews/i })
  await expect(cta).toHaveAttribute('href', /go\.heyelsie\.com\/onboarding/)
  // Compliance strip present (no-gating promise is a legal requirement)
  await expect(page.getByText(/cherry-picking happy customers/i)).toBeVisible()
})

test('onboarding: account creation lands on the customer upload step', async ({ page }) => {
  await page.goto(`${GO}/onboarding`)
  await expect(page.getByRole('heading', { name: /Create your account/i })).toBeVisible()
  await page.getByPlaceholder('Your name').fill('QA Owner')
  await page.getByPlaceholder('Business name').fill(QA_BUSINESS)
  await page.getByPlaceholder('Email address').fill(QA_EMAIL)
  await page.getByPlaceholder('Choose a password').fill(QA_PASSWORD)
  await page.getByRole('button', { name: /Continue/i }).click()
  // Google connection is NOT part of onboarding any more; it happens on the dashboard after signup.
  await expect(page.getByRole('heading', { name: /Upload your customer list/i })).toBeVisible({ timeout: 20000 })
  await grabSession(page)
})

test('reviews dashboard renders for the new account (login flow)', async ({ page }) => {
  // Fresh context per test — prove the login screen works too.
  await page.goto(`${GO}/dashboard`)
  await page.getByPlaceholder('Email').fill(QA_EMAIL)
  await page.getByPlaceholder('Password').fill(QA_PASSWORD)
  await page.getByRole('button', { name: /Sign in/i }).click()
  await expect(page.getByText('Last 30 days performance')).toBeVisible({ timeout: 20000 })
  await expect(page.getByText('New reviews', { exact: false }).first()).toBeVisible()
  await expect(page.getByText('Requests sent', { exact: false }).first()).toBeVisible()
  // Rating projection + milestones card
  await expect(page.getByText('Rating projection')).toBeVisible()
  // Google connection lives here post-signup: the connect card shows until linked
  await expect(page.getByText('Connect your Google Business Profile').first()).toBeVisible()
  await expect(page.getByRole('button', { name: /Connect with Google/i })).toBeVisible()
  await grabSession(page)

  const { data } = await page.evaluate(async (token) => {
    const res = await fetch('/api/reviews/settings', { headers: { Authorization: `Bearer ${token}` } })
    return { data: await res.json() }
  }, accessToken)
  businessId = data.settings.business_id
  expect(businessId).toBeTruthy()
})

test('add a single contact with consent, see it in contacts', async ({ page }) => {
  await page.goto(`${GO}/dashboard`)
  await page.getByPlaceholder('Email').fill(QA_EMAIL)
  await page.getByPlaceholder('Password').fill(QA_PASSWORD)
  await page.getByRole('button', { name: /Sign in/i }).click()
  await expect(page.getByText('Last 30 days performance')).toBeVisible({ timeout: 20000 })

  await page.getByRole('link', { name: 'Add Contacts' }).click()
  await page.getByPlaceholder('First name *').fill('Testy')
  await page.getByPlaceholder('Last name').fill('McTestface')
  await page.getByPlaceholder('Email address').fill(`customer-${RUN_ID}@example.com`)
  await page.getByText('I have the required consent').click()
  await page.getByRole('button', { name: 'Add contact' }).click()
  await expect(page.getByText(/Contact added/i)).toBeVisible({ timeout: 15000 })

  await page.getByRole('link', { name: 'Contacts', exact: true }).click()
  await expect(page.getByText('Testy McTestface')).toBeVisible({ timeout: 15000 })
})

test('billing shows the three tiers and creates a real Stripe checkout session', async ({ page }) => {
  await page.goto(`${GO}/dashboard`)
  await page.getByPlaceholder('Email').fill(QA_EMAIL)
  await page.getByPlaceholder('Password').fill(QA_PASSWORD)
  await page.getByRole('button', { name: /Sign in/i }).click()
  await expect(page.getByText('Last 30 days performance')).toBeVisible({ timeout: 20000 })
  await grabSession(page)

  await page.getByRole('link', { name: 'Billing' }).click()
  await expect(page.getByText('£99')).toBeVisible()
  await expect(page.getByText('£179')).toBeVisible()
  await expect(page.getByText('£279')).toBeVisible()
  await expect(page.getByText('Popular')).toBeVisible()

  // Checkout session creation (14-day trial, card required) — server-side call,
  // no card is charged by creating a session.
  const out = await page.evaluate(async (token) => {
    const res = await fetch('/api/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ priceId: 'price_1TvIMsLdAEhwWg6w9VFZFSJ0', returnPath: '/billing' }),
    })
    return res.json()
  }, accessToken)
  expect(String(out.url)).toContain('checkout.stripe.com')
})

test('referrals page exposes the £100/£100 link', async ({ page }) => {
  await page.goto(`${GO}/dashboard`)
  await page.getByPlaceholder('Email').fill(QA_EMAIL)
  await page.getByPlaceholder('Password').fill(QA_PASSWORD)
  await page.getByRole('button', { name: /Sign in/i }).click()
  await expect(page.getByText('Last 30 days performance')).toBeVisible({ timeout: 20000 })

  await page.getByRole('link', { name: 'Refer a Friend' }).click()
  await expect(page.getByText('Give £100, Get £100').first()).toBeVisible()
  const linkInput = page.locator('input[readonly]').first()
  await expect(linkInput).toHaveValue(/onboarding\?ref=/)
})

test('scheduling: exact first-request delay options, follow-up labels, no pace slider', async ({ page }) => {
  await page.goto(`${GO}/dashboard`)
  await page.getByPlaceholder('Email').fill(QA_EMAIL)
  await page.getByPlaceholder('Password').fill(QA_PASSWORD)
  await page.getByRole('button', { name: /Sign in/i }).click()
  await expect(page.getByText('Last 30 days performance')).toBeVisible({ timeout: 20000 })

  await page.getByRole('link', { name: 'Scheduling' }).click()
  await expect(page.getByText('Initial request scheduling')).toBeVisible({ timeout: 15000 })
  const delaySelect = page.locator('select')
  await expect(delaySelect).toBeVisible()
  const options = await delaySelect.locator('option').allTextContents()
  expect(options).toEqual(['Right away', 'Few hours', '24 hours', '2 days', '3 days', '4 days', '5 days', '6 days', '1 week'])
  // Requests-per-day pace control is gone
  await expect(page.getByText(/requests\/day/i)).toHaveCount(0)

  // Follow-up options use the exact labels
  await expect(page.getByRole('button', { name: 'No follow-ups' })).toBeVisible()
  await expect(page.getByRole('button', { name: '3 follow-ups' })).toBeVisible()

  // Changing the delay persists via the settings API
  await delaySelect.selectOption('48')
  await expect(page.getByText('First request: 2 days')).toBeVisible({ timeout: 15000 })
  await page.reload()
  await expect(page.locator('select')).toHaveValue('48', { timeout: 15000 })
})

test('social posting: toggle, post preview, posted + eligible sections', async ({ page }) => {
  await page.goto(`${GO}/dashboard`)
  await page.getByPlaceholder('Email').fill(QA_EMAIL)
  await page.getByPlaceholder('Password').fill(QA_PASSWORD)
  await page.getByRole('button', { name: /Sign in/i }).click()
  await expect(page.getByText('Last 30 days performance')).toBeVisible({ timeout: 20000 })

  await page.getByRole('link', { name: 'Social Posting' }).click()
  await expect(page.getByRole('heading', { name: 'Social Posting' })).toBeVisible({ timeout: 15000 })
  await expect(page.getByText('Automatically share new 5-star reviews as posts')).toBeVisible()
  await expect(page.getByText('What a post looks like')).toBeVisible()
  await expect(page.getByText(/Sample post/)).toBeVisible()
  await expect(page.getByText('Posted (0)')).toBeVisible()
  await expect(page.getByText('Recent 5-star reviews (0)')).toBeVisible()

  // Toggling persists auto_post_five_star through the settings API
  await page.getByRole('switch').click()
  await expect(page.getByText(/Auto-posting on/i)).toBeVisible({ timeout: 15000 })
  await page.reload()
  await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'true', { timeout: 15000 })
})

test('widget embed endpoint serves JS for this business (all ratings, branded)', async ({ request }) => {
  const res = await request.get(`${APP}/api/widget/grid?business-id=${businessId}`)
  expect(res.status()).toBe(200)
  expect(res.headers()['content-type']).toContain('javascript')
  const js = await res.text()
  expect(js).toContain('Powered by HeyElsie')
  expect(js).not.toContain('filter') // no rating filtering anywhere in the payload
})

test('widget renders on a plain HTML page', async ({ page }) => {
  await page.setContent(`
    <html><body>
      <div id="elsie-reviews-grid"></div>
      <script src="${APP}/api/widget/grid?business-id=${businessId}" defer></script>
    </body></html>`)
  // Shadow DOM host populated (empty-state text is fine — account has no reviews)
  await expect(page.locator('#elsie-reviews-grid')).toBeAttached()
  await page.waitForTimeout(1500)
  const shadowText = await page.evaluate(() => {
    const host = document.getElementById('elsie-reviews-grid')
    return host?.shadowRoot?.textContent ?? ''
  })
  expect(shadowText).toContain('Powered by HeyElsie')
})

test('compliance: reviews SMS webhook fails closed without a Twilio signature', async ({ request }) => {
  const res = await request.post(`${APP}/api/webhooks/twilio-reviews-sms`, {
    form: { From: '+447700900000', To: '+447700900001', Body: 'STOP' },
  })
  expect(res.status()).toBe(403)
})

test('compliance: zernio webhook rejects unsigned payloads', async ({ request }) => {
  const res = await request.post(`${APP}/api/webhooks/zernio`, {
    data: { event: 'review.new', review: { id: 'x' } },
  })
  expect([403, 500]).toContain(res.status())
})

test('click redirect route exists (/r/…)', async ({ request }) => {
  const res = await request.get(`${APP}/r/nonexistent-token`, { maxRedirects: 0 })
  expect(res.status()).toBe(302)
  expect(res.headers()['location']).toContain('heyelsie.com')
})
