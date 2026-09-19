import { test, expect } from '@playwright/test'
const FILE = 'file:///Users/hugo/Whats/Poppy/scripts/timesheet/preview.html'

test('tabs switch and only one week shows at a time', async ({ page }) => {
  await page.goto(FILE)
  const latest = page.locator('#pane-sep14')
  const sep = page.locator('#pane-sep07')
  const aug = page.locator('#pane-aug24')
  // the newest week opens first
  await expect(latest).toBeVisible()
  await expect(sep).toBeHidden()
  await expect(aug).toBeHidden()
  await expect(page.locator('#pane-sep14 .hstat.pay .val')).toHaveText('$68.00')

  await page.locator('label[for="t-sep07"]').click()
  await expect(sep).toBeVisible()
  await expect(latest).toBeHidden()
  await expect(page.locator('#pane-sep07 .hstat.pay .val')).toHaveText('$70.00')

  await page.locator('label[for="t-aug24"]').click()
  await expect(aug).toBeVisible()
  await expect(sep).toBeHidden()
  await expect(page.locator('#pane-aug24 .hstat.pay .val')).toHaveText('$65.00')

  // no horizontal overflow on a phone
  await page.setViewportSize({ width: 390, height: 844 })
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(over).toBeLessThanOrEqual(1)
})
