import { test, expect } from '@playwright/test'
const FILE = 'file:///Users/hugo/Whats/Poppy/scripts/timesheet/preview.html'

test('tabs switch and only one week shows at a time', async ({ page }) => {
  await page.goto(FILE)
  const sep = page.locator('#pane-sep07')
  const aug = page.locator('#pane-aug24')
  await expect(sep).toBeVisible()
  await expect(aug).toBeHidden()
  await expect(page.locator('#pane-sep07 .hstat.pay .val')).toHaveText('$70.00')
  await page.screenshot({ path: '/private/tmp/claude-501/-Users-hugo-Whats-Poppy/9caf005d-0578-4218-b224-998878d02ddc/scratchpad/tab-sep.png', fullPage: false })

  await page.locator('label[for="t-aug24"]').click()
  await expect(aug).toBeVisible()
  await expect(sep).toBeHidden()
  await expect(page.locator('#pane-aug24 .hstat.pay .val')).toHaveText('$65.00')
  await page.screenshot({ path: '/private/tmp/claude-501/-Users-hugo-Whats-Poppy/9caf005d-0578-4218-b224-998878d02ddc/scratchpad/tab-aug.png', fullPage: false })

  // no horizontal overflow on a phone
  await page.setViewportSize({ width: 390, height: 844 })
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(over).toBeLessThanOrEqual(1)
  await page.screenshot({ path: '/private/tmp/claude-501/-Users-hugo-Whats-Poppy/9caf005d-0578-4218-b224-998878d02ddc/scratchpad/tab-mobile.png', fullPage: false })
})
