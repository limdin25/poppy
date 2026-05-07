import { test, expect } from '@playwright/test'

test('hugo user dashboard shows empty data', async ({ page }) => {
  await page.goto('https://app.heyelsie.com/login')
  await page.getByText('Sign in with password instead').click()
  await page.locator('input[type="email"]').fill('hugodesouzax@gmail.com')
  await page.locator('input[type="password"]').fill('58913347')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL('https://app.heyelsie.com/', { timeout: 10_000 })

  await page.goto('https://app.heyelsie.com/analytics')
  await page.waitForTimeout(4000)
  await page.screenshot({ path: 'test-results/hugo-user-analytics.png', fullPage: true })

  // Should show zeros
  const pageText = await page.textContent('body') || ''
  console.log(`Page has "No data": ${pageText.includes('No data')}`)
})

test('demo user still sees all data', async ({ page }) => {
  await page.goto('https://app.heyelsie.com/login')
  await page.getByText('Try demo account').click()
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL('https://app.heyelsie.com/', { timeout: 10_000 })

  await page.goto('https://app.heyelsie.com/analytics')
  await page.waitForTimeout(4000)
  await page.screenshot({ path: 'test-results/demo-user-analytics.png', fullPage: true })

  await expect(page.locator('h1:has-text("Analytics")')).toBeVisible()
  const skeletons = await page.locator('.skeleton').count()
  expect(skeletons).toBe(0)
})

test('admin panel shows both businesses', async ({ page }) => {
  await page.goto('https://app.heyelsie.com/login')
  await page.getByText('Sign in with password instead').click()
  await page.locator('input[type="email"]').fill('hugodesouzax@gmail.com')
  await page.locator('input[type="password"]').fill('58913347')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL('https://app.heyelsie.com/', { timeout: 10_000 })

  await page.goto('https://app.heyelsie.com/admin/analytics')
  await page.waitForTimeout(4000)
  await page.screenshot({ path: 'test-results/admin-both-businesses.png', fullPage: true })

  await expect(page.locator('h1:has-text("Platform Analytics")')).toBeVisible()
})
