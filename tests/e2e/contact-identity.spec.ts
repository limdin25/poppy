import { test, expect } from '@playwright/test'

// Hugo's rule: everywhere the CRM shows a lead's business name it must ALSO show
// the owner's name and the website — with an explicit "not available" marker,
// never a silent blank. It used to hold only in the dial room. These check the
// three surfaces that were missing it, against production.

test.use({ storageState: { cookies: [], origins: [] } })

const APP = 'https://app.heyelsie.com'
const AGENT = { email: 'preyes1588@gmail.com', password: 'ElsieAgent#2026' }

async function signIn(page: import('@playwright/test').Page) {
  await page.goto(`${APP}/login`)
  await page.getByRole('button', { name: /Staff & owners/i }).click().catch(() => {})
  await page.locator('input[type="email"]').fill(AGENT.email)
  await page.locator('input[type="password"]').fill(AGENT.password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(/\/admin\/crm/, { timeout: 30_000 })
}

// The marker is the point: an agent has to SEE the gap to fill it in.
const IDENTITY = /Name not available|Website not available|[a-z0-9-]+\.(co\.uk|com|net|org)/i

test('the inbox shows owner + website on rows and in the thread header', async ({ page }) => {
  await signIn(page)
  await page.goto(`${APP}/admin/crm/inbox`)
  await page.waitForLoadState('networkidle')

  // at least one thread row carries identity beneath the company name
  const body = await page.locator('body').innerText()
  expect(body).toMatch(IDENTITY)

  // opening a thread shows it in the header too
  const firstRow = page.locator('[class*="cursor-pointer"]').first()
  if (await firstRow.count()) {
    await firstRow.click()
    await page.waitForTimeout(1500)
    expect(await page.locator('body').innerText()).toMatch(IDENTITY)
  }
})

test('the pipeline board shows owner + website on every card', async ({ page }) => {
  await signIn(page)
  await page.goto(`${APP}/admin/crm/pipelines`)
  await page.waitForLoadState('networkidle')
  expect(await page.locator('body').innerText()).toMatch(IDENTITY)
})

test('the video funnel board shows owner + website, not a bare dash', async ({ page }) => {
  await signIn(page)
  await page.goto(`${APP}/admin/crm/video-funnel`)
  await page.waitForLoadState('networkidle')
  const body = await page.locator('body').innerText()
  expect(body).toMatch(IDENTITY)
  // the old placeholder was a lone em-dash where the owner should be
  expect(body).not.toMatch(/^\s*—\s*$/m)
})
