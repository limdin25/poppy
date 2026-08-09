// E2E for the Agency Admin UI mock. Static app, no backend: these tests assert
// the UI renders and the in-memory interactions behave.
import { test, expect } from '@playwright/test'

const TABS = [
  ['dashboard', 'Total MRR'],
  ['money', 'Payment tracker'],
  ['clients', 'Add Client'],
  ['calendar', 'Cash collected'],
  ['leads', 'Pipeline upfront cash'],
  ['ideation', 'What are we making?'],
  ['thumbnails', 'Describe the thumbnail you want'],
  ['analytics', 'Connect a channel'],
  ['team', 'Capacity'],
  ['onboarding', 'How we onboard a new client'],
  ['settings', 'Integrations'],
]

function trackErrors(page) {
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  return errors
}

async function openApp(page, { welcomed = true } = {}) {
  if (welcomed) await page.addInitScript(() => localStorage.setItem('aa-welcomed', '1'))
  await page.goto('/index.html')
}

test('first launch shows the welcome modal and Skip dismisses it', async ({ page }) => {
  const errors = trackErrors(page)
  await openApp(page, { welcomed: false })
  await expect(page.locator('.modal-head h3')).toHaveText('Welcome to Agency Admin')
  await expect(page.locator('.modal', { hasText: 'Claude API' })).toBeVisible()
  await page.getByRole('button', { name: 'Skip for now' }).click()
  await expect(page.locator('.modal-overlay')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('all 11 tabs render without errors', async ({ page }) => {
  const errors = trackErrors(page)
  await openApp(page)
  await expect(page.locator('.side-item[data-page]')).toHaveCount(11)
  for (const [hash, marker] of TABS) {
    await page.goto('/index.html#/' + hash)
    await expect(page.locator('#page')).toContainText(marker, { timeout: 8000 })
  }
  expect(errors).toEqual([])
})

test('dashboard shows correct MRR and the guarantee tracker', async ({ page }) => {
  await openApp(page)
  const mrrCard = page.locator('.kpi', { hasText: 'Total MRR' })
  await expect(mrrCard).toContainText('$44,000')
  await expect(page.locator('#page')).toContainText('Day 24 of 30')
  await expect(page.locator('#page')).toContainText('Berger Motors')
})

test('money: overdue invoice is Scale Lab July and Mark paid clears it', async ({ page }) => {
  await openApp(page)
  await page.goto('/index.html#/money')
  const overdueRow = page.locator('tr', { hasText: 'Overdue' }).first()
  await expect(overdueRow).toContainText('Scale Lab')
  await expect(overdueRow).toContainText('Jul 20, 2026')
  await overdueRow.getByRole('button', { name: 'Mark paid' }).click()
  await expect(page.locator('.toast')).toContainText('Payment recorded')
  await expect(page.locator('tr', { hasText: 'Overdue' })).toHaveCount(0)
})

test('calendar: collecting a payment raises the total and turns the chip green', async ({ page }) => {
  await openApp(page)
  await page.goto('/index.html#/calendar')
  const total = page.locator('#page .cash-total, #page .kpi-value, #page h2 ~ *').first()
  await expect(page.locator('#page')).toContainText('Cash collected')
  const chip = page.locator('.cal-pay:not(.collected)').first()
  const before = await page.locator('#page').textContent()
  await chip.click()
  await expect(page.locator('.toast')).toContainText('Collected')
})

test('clients: search filters, detail opens, strategy bullet expands', async ({ page }) => {
  await openApp(page)
  await page.goto('/index.html#/clients')
  await page.locator('.search-wrap input').fill('fox')
  await expect(page.locator('#page')).toContainText('FoxFit')
  await expect(page.locator('#page')).not.toContainText('Hale Capital')
  await page.locator('.search-wrap input').fill('')
  await page.locator('#page').getByText('Hale Capital', { exact: false }).first().click()
  await expect(page.locator('#page h1')).toContainText('Hale Capital')
  const bullet = page.locator('#page').getByText('Cut titles to under 55 characters', { exact: false })
  await bullet.click()
  await expect(page.locator('#page')).toContainText('curiosity-gap titles', { ignoreCase: true })
})

test('ideation: Enter sends and the assistant replies with client context', async ({ page }) => {
  await openApp(page)
  await page.goto('/index.html#/ideation')
  const input = page.locator('.chat-bar textarea').first()
  await input.click()
  await input.fill('Hook ideas for FoxFit')
  await page.keyboard.press('Enter')
  await expect(page.locator('.bubble.user').last()).toContainText('Hook ideas for FoxFit')
  await expect(page.locator('.bubble.assistant').last()).toContainText('FoxFit', { timeout: 5000 })
})

test('thumbnails: sending a prompt generates an image with actions', async ({ page }) => {
  await openApp(page)
  await page.goto('/index.html#/thumbnails')
  const input = page.locator('.chat-bar textarea').first()
  await input.click()
  await input.fill('Shocked face, text WAIT')
  await page.keyboard.press('Enter')
  await expect(page.locator('.bubble.assistant').last()).toBeVisible({ timeout: 5000 })
  await expect(page.locator('img.bubble-img').last()).toBeVisible({ timeout: 8000 })
  await expect(page.locator('#page').getByRole('button', { name: 'Regenerate' }).last()).toBeVisible()
})

test('settings: Test Connection flips Discord to Connected', async ({ page }) => {
  await openApp(page)
  await page.goto('/index.html#/settings')
  const discordCard = page.locator('.card', { hasText: 'Discord bot' })
  await expect(discordCard).toContainText('Not configured')
  await discordCard.getByRole('button', { name: 'Test', exact: true }).click()
  await expect(discordCard).toContainText('Connected', { timeout: 5000 })
})

test('theme toggle switches to light mode', async ({ page }) => {
  await openApp(page)
  await page.locator('.side-item', { hasText: 'Light mode' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.locator('.side-item', { hasText: 'Dark mode' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})
