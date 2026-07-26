import { test, expect } from '@playwright/test'

// Test the login flow itself → start from a clean, logged-out context (also
// avoids needing the setup project's saved storageState).
test.use({ storageState: { cookies: [], origins: [] } })

const APP = 'https://app.heyelsie.com'

test('the old /admin/crm/login now redirects to the single /login', async ({ page }) => {
  await page.goto(`${APP}/admin/crm/login`)
  await page.waitForURL(/\/login(\?|#|$)/, { timeout: 20_000 })
  expect(page.url()).toMatch(/\/login(\?|#|$)/)
})

test('/login shows the Staff vs Reviews-client split, and the client path points to go.', async ({ page }) => {
  await page.goto(`${APP}/login`)
  await expect(page.getByRole('button', { name: /Staff & owners/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /Reviews client/i })).toBeVisible()
  // Client tab → a button through to go.heyelsie.com
  await page.getByRole('button', { name: /Reviews client/i }).click()
  const goLink = page.getByRole('link', { name: /go\.heyelsie\.com/i })
  await expect(goLink).toBeVisible()
  expect(await goLink.getAttribute('href')).toContain('go.heyelsie.com')
})

test('a staff account signs in once at /login and lands in the CRM', async ({ page }) => {
  await page.goto(`${APP}/login`)
  await page.locator('input[type="email"]').fill('preyes1588@gmail.com')
  await page.locator('input[type="password"]').fill('ElsieAgent#2026')
  await page.locator('button[type="submit"]').click()
  // Role-routing sends CRM staff straight to the CRM — no second login.
  await page.waitForURL(/\/admin\/crm\//, { timeout: 30_000 })
  expect(page.url()).toContain('/admin/crm')
})

const GO = 'https://go.heyelsie.com'

test('go. login shows a Staff link to app.', async ({ page }) => {
  await page.goto(GO)
  // Locate by DESTINATION, not by label. This used to match on the accessible
  // name "app.heyelsie.com"; the copy was later changed to "Staff & agent
  // sign-in →" and the test has been red ever since while the link itself was
  // fine. What actually matters is where it points.
  const staffLink = page.locator('a[href*="app.heyelsie.com/login"]')
  await expect(staffLink).toBeVisible()
  expect(await staffLink.getAttribute('href')).toContain('app.heyelsie.com/login')
})

test('a staff account that logs in on go. is bounced to app./login (no dead-end)', async ({ page }) => {
  await page.goto(GO)
  await page.locator('input[type="email"]').fill('preyes1588@gmail.com')
  await page.locator('input[type="password"]').fill('ElsieAgent#2026')
  await page.getByRole('button', { name: /sign in/i }).click()
  // ReviewsApp detects a CRM-staff account → clears the stray session and sends
  // them to the single app login (not the old failing /admin/crm/inbox).
  await page.waitForURL(/app\.heyelsie\.com\/login/, { timeout: 30_000 })
  expect(page.url()).toContain('app.heyelsie.com/login')
})
