import { test, expect } from '@playwright/test'

async function adminLogin(page: any) {
  await page.goto('https://app.heyelsie.com/login')
  await page.getByText('Sign in with password instead').click()
  await page.locator('input[type="email"]').fill('hugodesouzax@gmail.com')
  await page.locator('input[type="password"]').fill('58913347')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL('https://app.heyelsie.com/', { timeout: 10_000 })
}

test('View as client navigates to main app with impersonation banner', async ({ page }) => {
  await adminLogin(page)

  // Go to Smith Plumbing business detail
  await page.goto('https://app.heyelsie.com/admin/businesses/8867c609-1686-4c09-82b1-3c55fb09c431')
  await page.waitForTimeout(3000)

  // Verify business loaded
  const body = await page.textContent('body') || ''
  expect(body).toContain('Smith Plumbing')

  // Screenshot before clicking
  await page.screenshot({ path: 'test-results/impersonation-before.png', fullPage: true })

  // Click "View as client"
  await page.getByRole('button', { name: 'View as client' }).click()
  await page.waitForTimeout(2000)

  // Should be on main app now
  await page.screenshot({ path: 'test-results/impersonation-active.png', fullPage: true })

  // Check URL is main app
  expect(page.url()).toContain('app.heyelsie.com/')
  expect(page.url()).not.toContain('/admin')

  // Check impersonation banner is visible
  const banner = await page.textContent('body') || ''
  expect(banner).toContain('Viewing as')
  expect(banner).toContain('Smith Plumbing')

  // Verify data loads — no "No session" errors, page renders real content
  // Navigate to a few pages to confirm RLS allows data access
  await page.goto('https://app.heyelsie.com/contacts')
  await page.waitForTimeout(3000)
  await page.screenshot({ path: 'test-results/impersonation-contacts.png', fullPage: true })
  const contactsBody = await page.textContent('body') || ''
  expect(contactsBody).toContain('Viewing as')
  expect(contactsBody).not.toContain('No session')

  await page.goto('https://app.heyelsie.com/calls')
  await page.waitForTimeout(3000)
  const callsBody = await page.textContent('body') || ''
  expect(callsBody).toContain('Viewing as')
  expect(callsBody).not.toContain('No session')

  // Click Exit
  const exitBtn = page.locator('button:has-text("Exit")')
  await expect(exitBtn).toBeVisible()
  await exitBtn.click()
  await page.waitForTimeout(1000)

  // Should be back in admin
  await page.screenshot({ path: 'test-results/impersonation-exit.png', fullPage: true })
  expect(page.url()).toContain('/admin')
})

test('All admin pages show data, no silent errors', async ({ page }) => {
  test.setTimeout(90_000)
  await adminLogin(page)

  // Businesses page
  await page.goto('https://app.heyelsie.com/admin/businesses')
  await page.waitForTimeout(3000)
  let body = await page.textContent('body') || ''
  console.log('Businesses: has Smith =', body.includes('Smith Plumbing'))
  expect(body).toContain('Smith Plumbing')
  expect(body).not.toContain('No session')

  // Users page
  await page.goto('https://app.heyelsie.com/admin/users')
  await page.waitForTimeout(3000)
  body = await page.textContent('body') || ''
  console.log('Users: has demo =', body.includes('demo@poppy.ai'))
  expect(body).toContain('demo@poppy.ai')

  // Dashboard
  await page.goto('https://app.heyelsie.com/admin')
  await page.waitForTimeout(3000)
  body = await page.textContent('body') || ''
  expect(body).toContain('Dashboard')

  // Business detail
  await page.goto('https://app.heyelsie.com/admin/businesses/8867c609-1686-4c09-82b1-3c55fb09c431')
  await page.waitForTimeout(3000)
  body = await page.textContent('body') || ''
  expect(body).toContain('Smith Plumbing')
  expect(body).toContain('View as client')

  // All other pages should not show error alerts
  const pages = [
    '/admin/calls',
    '/admin/conversations',
    '/admin/billing',
    '/admin/ai',
    '/admin/numbers',
    '/admin/feature-flags',
    '/admin/system',
    '/admin/analytics',
    '/admin/audit-log',
  ]

  for (const p of pages) {
    await page.goto(`https://app.heyelsie.com${p}`)
    await page.waitForTimeout(2000)
    body = await page.textContent('body') || ''
    const hasSessionError = body.includes('No session')
    const has403 = body.includes('403')
    console.log(`${p}: session_error=${hasSessionError}, 403=${has403}`)
    expect(hasSessionError).toBe(false)
    expect(has403).toBe(false)
  }
})
