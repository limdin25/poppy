// Captures the client website's MOBILE version as a crisp full-page PNG
// (390 CSS px iPhone viewport @2x = 780px-wide image). The scroll itself is
// animated in Remotion so it can be timed to the voice exactly.
// Usage: node video/capture-mobile-site.mjs
import { chromium, devices } from 'playwright'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const dir = dirname(fileURLToPath(import.meta.url))
const OUT = join(dir, 'public', 'client-mobile.png')

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({
  ...devices['iPhone 13'],
  deviceScaleFactor: 2,
})
const page = await ctx.newPage()
await page.goto('https://www.theboilerclubonline.co.uk/', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(3000)
// remove the cookie banner outright so it doesn't sit over the page
await page.evaluate(() => {
  // remove every container that carries the banner (outermost included),
  // as long as it isn't a page-level wrapper
  ;[...document.querySelectorAll('div,section,aside')]
    .filter((e) => e.textContent?.includes('We use cookies') && e.clientHeight > 20 && e.clientHeight < 600)
    .forEach((e) => e.remove())
})
await page.waitForTimeout(800)
await page.screenshot({ path: OUT, fullPage: true })
const size = await page.evaluate(() => ({ w: innerWidth, h: document.body.scrollHeight }))
console.log('saved', OUT, 'viewport', size)
await browser.close()