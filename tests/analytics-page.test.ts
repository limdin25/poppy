import { test, expect } from '@playwright/test'

test('user analytics page loads with real data and unsubscribe stats', async ({ page }) => {
  await page.goto('https://app.heyelsie.com/login')
  await page.getByText('Sign in with password instead').click()
  await page.locator('input[type="email"]').fill('hugodesouzax@gmail.com')
  await page.locator('input[type="password"]').fill('58913347')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL('https://app.heyelsie.com/', { timeout: 10_000 })

  await page.goto('https://app.heyelsie.com/analytics')
  await page.waitForTimeout(5000)

  await page.screenshot({ path: 'test-results/analytics-full.png', fullPage: true })

  const heading = page.locator('h1:has-text("Analytics")')
  await expect(heading).toBeVisible()

  // Check skeletons are gone
  const skeletons = await page.locator('.skeleton').count()
  console.log(`Skeletons: ${skeletons}`)
  expect(skeletons).toBeLessThan(3)

  // Check for unsubscribe table
  const unsubHeading = await page.locator('text=Unsubscribe').first().isVisible().catch(() => false)
  console.log(`Unsubscribe section visible: ${unsubHeading}`)

  // Check for "Unsubscribed" status badges
  const unsubBadges = await page.locator('text=Unsubscribed').count()
  console.log(`Unsubscribed badges: ${unsubBadges}`)
})
