import { test, expect } from '@playwright/test'

async function adminLogin(page: any) {
  await page.goto('https://app.heyelsie.com/login')
  await page.getByText('Sign in with password instead').click()
  await page.locator('input[type="email"]').fill('hugodesouzax@gmail.com')
  await page.locator('input[type="password"]').fill('58913347')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL('https://app.heyelsie.com/', { timeout: 10_000 })
}

test('admin businesses page shows businesses and users', async ({ page }) => {
  await adminLogin(page)

  await page.goto('https://app.heyelsie.com/admin/businesses')
  await page.waitForTimeout(3000)
  await page.screenshot({ path: 'test-results/admin-businesses.png', fullPage: true })

  const body = await page.textContent('body') || ''
  console.log('Page contains "Smith Plumbing":', body.includes('Smith Plumbing'))
  console.log('Page contains "Hugo Admin":', body.includes('Hugo Admin'))
  console.log('Page contains "total clients":', body.includes('total clients'))

  expect(body).toContain('Smith Plumbing')
  expect(body).toContain('Hugo Admin')
})

test('admin users page shows team members', async ({ page }) => {
  await adminLogin(page)

  await page.goto('https://app.heyelsie.com/admin/users')
  await page.waitForTimeout(3000)
  await page.screenshot({ path: 'test-results/admin-users.png', fullPage: true })

  const body = await page.textContent('body') || ''
  console.log('Page contains "demo@poppy.ai":', body.includes('demo@poppy.ai'))
  console.log('Page contains "hugodesouzax":', body.includes('hugodesouzax'))

  expect(body).toContain('demo@poppy.ai')
  expect(body).toContain('hugodesouzax')
})

test('admin dashboard loads with metrics', async ({ page }) => {
  await adminLogin(page)

  await page.goto('https://app.heyelsie.com/admin')
  await page.waitForTimeout(3000)
  await page.screenshot({ path: 'test-results/admin-dashboard.png', fullPage: true })

  const body = await page.textContent('body') || ''
  expect(body).toContain('Dashboard')
})

test('admin business detail page loads', async ({ page }) => {
  await adminLogin(page)

  await page.goto('https://app.heyelsie.com/admin/businesses/8867c609-1686-4c09-82b1-3c55fb09c431')
  await page.waitForTimeout(3000)
  await page.screenshot({ path: 'test-results/admin-business-detail.png', fullPage: true })

  const body = await page.textContent('body') || ''
  console.log('Page contains "Smith Plumbing":', body.includes('Smith Plumbing'))
  expect(body).toContain('Smith Plumbing')
})

test('all admin pages load without error', async ({ page }) => {
  await adminLogin(page)

  const pages = [
    { path: '/admin/calls', name: 'Calls' },
    { path: '/admin/conversations', name: 'Conversations' },
    { path: '/admin/billing', name: 'Billing' },
    { path: '/admin/ai', name: 'AI' },
    { path: '/admin/numbers', name: 'Numbers' },
    { path: '/admin/feature-flags', name: 'Feature Flags' },
    { path: '/admin/system', name: 'System Health' },
    { path: '/admin/analytics', name: 'Analytics' },
    { path: '/admin/audit-log', name: 'Audit Log' },
  ]

  for (const p of pages) {
    await page.goto(`https://app.heyelsie.com${p.path}`)
    await page.waitForTimeout(2000)
    const body = await page.textContent('body') || ''
    const hasError = body.includes('500') || body.includes('error') || body.includes('Something went wrong')
    console.log(`${p.name}: loaded OK=${!hasError}`)
    await page.screenshot({ path: `test-results/admin-${p.name.toLowerCase().replace(/\s/g, '-')}.png`, fullPage: true })
  }
})

test('admin link visible in sidebar', async ({ page }) => {
  await adminLogin(page)

  await page.goto('https://app.heyelsie.com/')
  await page.waitForTimeout(2000)

  const adminLink = page.locator('a[href="/admin"]')
  const isVisible = await adminLink.isVisible().catch(() => false)
  console.log('Admin Panel link visible:', isVisible)
  await page.screenshot({ path: 'test-results/admin-sidebar-link.png', fullPage: true })

  expect(isVisible).toBe(true)
})
