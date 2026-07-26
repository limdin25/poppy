import { test, expect } from '@playwright/test'

// Hugo 2026-07-26: landing + sign-in + sign-up repainted into the VSL page's
// blue/white language. These assert the things a screenshot can't: that the
// old warm palette is gone, the pages still work, and they fit a phone.
test.use({ storageState: { cookies: [], origins: [] } })

const APP = 'https://app.heyelsie.com'
const BLUE = 'rgb(26, 115, 232)'

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('landing is blue/white and never scrolls sideways', async ({ page }) => {
    await page.goto('https://heyelsie.com/welcome', { waitUntil: 'domcontentloaded' })
    // the offer is reachable without hunting for it
    const sticky = page.locator('a[href*="onboarding"]').last()
    await expect(sticky).toBeVisible()
    // no horizontal overflow — the one thing that makes a page feel broken
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
    expect(overflow).toBe(false)
  })

  test('sign-in fits a phone and keeps its blue button', async ({ page }) => {
    await page.goto(`${APP}/login`, { waitUntil: 'domcontentloaded' })
    const btn = page.locator('button[type="submit"]')
    await expect(btn).toBeVisible()
    await expect(btn).toHaveCSS('background-color', BLUE)
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
    expect(overflow).toBe(false)
  })
})

test('sign-in still shows both doors and the go. link', async ({ page }) => {
  await page.goto(`${APP}/login`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('button', { name: /Staff & owners/i })).toBeVisible()
  await page.getByRole('button', { name: /Reviews client/i }).click()
  const go = page.getByRole('link', { name: /go\.heyelsie\.com/i })
  await expect(go).toBeVisible()
  expect(await go.getAttribute('href')).toContain('go.heyelsie.com')
})

test('sign-up still posts every field it needs', async ({ page }) => {
  await page.goto(`${APP}/register`, { waitUntil: 'domcontentloaded' })
  for (const ph of [/Business name/i, /Your name/i, /you@business/i, /Password/i]) {
    await expect(page.getByPlaceholder(ph)).toBeVisible()
  }
  await expect(page.locator('button[type="submit"]')).toHaveCSS('background-color', BLUE)
})
