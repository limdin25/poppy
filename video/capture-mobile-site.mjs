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
// Remove cookie/consent furniture. Learned on real leads (2026-07-26,
// wolverhamptongasplumbing said "We SERVE cookies" and sailed past the old
// literal-text match): kill by id/class keyword, by fixed-position cookie
// text, and finally any leftover full-screen dimmer overlay.
await page.evaluate(() => {
  const rx = /cookie|consent|gdpr|cmp-|qc-cmp|privacy-?(banner|popup|notice)/i
  for (const el of [...document.querySelectorAll('div,section,aside,dialog')]) {
    const idcls = `${el.id} ${typeof el.className === 'string' ? el.className : ''}`
    if (rx.test(idcls) && el.clientHeight > 20) { el.remove(); continue }
    const t = el.textContent || ''
    if (/cookies?/i.test(t) && el.clientHeight > 20 && el.clientHeight < 700
        && ['fixed', 'sticky'].includes(getComputedStyle(el).position)) el.remove()
  }
  // childless fixed overlays covering ~the viewport = modal dimmers
  for (const el of [...document.querySelectorAll('div')]) {
    const s = getComputedStyle(el)
    if (s.position === 'fixed' && el.childElementCount === 0
        && el.clientWidth >= innerWidth * 0.9 && el.clientHeight >= innerHeight * 0.9) el.remove()
  }
  document.documentElement.style.overflow = 'visible'
  document.body.style.overflow = 'visible'
})
await page.waitForTimeout(800)
await page.screenshot({ path: OUT, fullPage: true })
const size = await page.evaluate(() => ({ w: innerWidth, h: document.body.scrollHeight }))
// image px = CSS px × 2 (deviceScaleFactor); the comp works in 780-wide space
writeFileSync(`${OUT}.json`, JSON.stringify({ imageHeight: size.h * 2, cssHeight: size.h, url }))
console.log('saved', OUT, 'viewport', size)
await browser.close()
