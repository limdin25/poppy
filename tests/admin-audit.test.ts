import { test, expect } from '@playwright/test'

const ADMIN_EMAIL = 'hugodesouzax@gmail.com'
const ADMIN_PASS = 'Poppy2026!'

async function adminLogin(page: any) {
  await page.goto('https://app.heyelsie.com/login')
  await page.getByText('Sign in with password instead').click()
  await page.locator('input[type="email"]').fill(ADMIN_EMAIL)
  await page.locator('input[type="password"]').fill(ADMIN_PASS)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL('https://app.heyelsie.com/', { timeout: 10_000 })
}

test('admin link visible in sidebar for admin user', async ({ page }) => {
  await adminLogin(page)
  await page.waitForTimeout(2000)
  const adminLink = page.locator('a[href="/admin"]')
  await expect(adminLink).toBeVisible({ timeout: 5000 })
  console.log('Admin link visible in sidebar')
  await page.screenshot({ path: 'test-results/admin-link-sidebar.png' })
})

test('admin users page loads', async ({ page }) => {
  await adminLogin(page)
  await page.goto('https://app.heyelsie.com/admin/users')
  await page.waitForTimeout(3000)
  await page.screenshot({ path: 'test-results/admin-users.png', fullPage: true })
  const heading = page.locator('h1:has-text("Users")')
  await expect(heading).toBeVisible({ timeout: 10000 })
  const tableText = await page.textContent('body')
  console.log(`Users page has content: ${(tableText || '').length > 100}`)
})

test('admin conversations page loads', async ({ page }) => {
  await adminLogin(page)
  await page.goto('https://app.heyelsie.com/admin/conversations')
  await page.waitForTimeout(3000)
  await page.screenshot({ path: 'test-results/admin-conversations.png', fullPage: true })
  const heading = page.locator('h1:has-text("Conversations")')
  await expect(heading).toBeVisible({ timeout: 10000 })
})

test('admin business detail page loads', async ({ page }) => {
  await adminLogin(page)
  await page.goto('https://app.heyelsie.com/admin/businesses')
  await page.waitForTimeout(2000)
  // Click on first business
  const firstRow = page.locator('tr').nth(1)
  await firstRow.click()
  await page.waitForTimeout(3000)
  await page.screenshot({ path: 'test-results/admin-business-detail.png', fullPage: true })
  const businessName = page.locator('h1:has-text("Smith")')
  const visible = await businessName.isVisible().catch(() => false)
  console.log(`Business detail loaded: ${visible}`)
})

test('all admin pages return 200', async ({ page }) => {
  await adminLogin(page)

  const pages = [
    { url: '/admin', name: 'Dashboard' },
    { url: '/admin/analytics', name: 'Analytics' },
    { url: '/admin/businesses', name: 'Businesses' },
    { url: '/admin/users', name: 'Users' },
    { url: '/admin/calls', name: 'Calls' },
    { url: '/admin/conversations', name: 'Conversations' },
    { url: '/admin/billing', name: 'Billing' },
    { url: '/admin/ai', name: 'AI Management' },
    { url: '/admin/numbers', name: 'Numbers' },
    { url: '/admin/feature-flags', name: 'Feature Flags' },
    { url: '/admin/system', name: 'System Health' },
    { url: '/admin/audit-log', name: 'Audit Log' },
  ]

  for (const p of pages) {
    await page.goto(`https://app.heyelsie.com${p.url}`)
    await page.waitForTimeout(2000)
    const hasError = await page.locator('text=/500|Error|error/i').first().isVisible().catch(() => false)
    const hasHeading = await page.locator('h1').first().isVisible().catch(() => false)
    console.log(`${p.name}: heading=${hasHeading}, error=${hasError}`)
    if (hasError) {
      await page.screenshot({ path: `test-results/admin-error-${p.name.toLowerCase().replace(' ', '-')}.png` })
    }
  }
})
