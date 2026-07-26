// Captures the client website's MOBILE version as a crisp full-page PNG
// (390 CSS px iPhone viewport @2x = 780px-wide image). The scroll itself is
// animated in Remotion so it can be timed to the voice exactly.
//
// Usage: node video/capture-mobile-site.mjs [url] [outPath]
//   defaults keep the original sample capture behaviour.
// Writes <outPath>.json with { imageHeight } (px in the 780-wide space) —
// prep-lead.mjs feeds it to OpeningWebsiteV's scroll clamp.
//
// Gotchas (learned on real sites): use `www.` + domcontentloaded — bare
// domain / networkidle can die with ERR_CONNECTION_CLOSED; the cookie-banner
// removal only matches containers containing the literal "We use cookies",
// other consent wordings survive — eyeball each capture.
import { chromium, devices } from 'playwright'
import { writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const dir = dirname(fileURLToPath(import.meta.url))
const RAW_URL = process.argv[2] || 'https://www.theboilerclubonline.co.uk/'
const OUT = process.argv[3] || join(dir, 'public', 'client-mobile.png')

// normalize: force https + www. (the resilient combination)
let url = RAW_URL.trim()
if (!/^https?:\/\//.test(url)) url = `https://${url}`
if (!/^https?:\/\/www\./.test(url)) url = url.replace(/^(https?:\/\/)/, '$1www.')

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({
  ...devices['iPhone 13'],
  deviceScaleFactor: 2,
})
const page = await ctx.newPage()
try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
} catch {
  // some sites refuse the forced www. — retry exactly as given
  await page.goto(RAW_URL.startsWith('http') ? RAW_URL : `https://${RAW_URL}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
}
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
// image px = CSS px × 2 (deviceScaleFactor); the comp works in 780-wide space
writeFileSync(`${OUT}.json`, JSON.stringify({ imageHeight: size.h * 2, cssHeight: size.h, url }))
console.log('saved', OUT, 'viewport', size)
await browser.close()
