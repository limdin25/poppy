// Records the four dashboard clips for the VSL (demo account, prod).
// Usage: node video/record-clips.mjs
// Output: video/public/clips/0{1..4}-*.webm (1920x1080)
import { chromium } from 'playwright'
import { mkdirSync, renameSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const dir = dirname(fileURLToPath(import.meta.url))
const CLIPS = join(dir, 'public', 'clips')
const BASE = 'https://go.heyelsie.com'
const EMAIL = 'reviews-demo@heyelsie-qa.com'
const PASS = 'ReviewsDemo2026!'

mkdirSync(CLIPS, { recursive: true })

// human-ish scroll: small wheel steps with pauses, like reading the page
async function humanScroll(page, totalMs) {
  const t0 = Date.now()
  let down = true
  while (Date.now() - t0 < totalMs) {
    const steps = 2 + Math.floor(Math.random() * 3)
    for (let i = 0; i < steps; i++) {
      await page.mouse.wheel(0, down ? 90 + Math.random() * 110 : -(70 + Math.random() * 80))
      await page.waitForTimeout(120 + Math.random() * 180)
    }
    await page.waitForTimeout(900 + Math.random() * 1600) // dwell, as if reading
    if (Math.random() < 0.3) down = !down // occasionally drift back up
    const y = await page.evaluate(() => window.scrollY)
    const max = await page.evaluate(() => document.body.scrollHeight - innerHeight)
    if (y >= max - 10) down = false
    if (y <= 10) down = true
  }
}

async function driftMouse(page, times) {
  for (let i = 0; i < times; i++) {
    await page.mouse.move(300 + Math.random() * 1200, 200 + Math.random() * 600, { steps: 30 })
    await page.waitForTimeout(600 + Math.random() * 900)
  }
}

async function recordClip(browser, state, name, path, dwellMs, mouseDrifts = 2) {
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: CLIPS, size: { width: 1920, height: 1080 } },
    storageState: state,
  })
  const page = await ctx.newPage()
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500) // let the page settle before "talking"
  await driftMouse(page, mouseDrifts)
  await humanScroll(page, dwellMs)
  await page.waitForTimeout(800)
  await ctx.close()
  // newest webm in the dir is ours
  const files = readdirSync(CLIPS).filter((f) => f.endsWith('.webm'))
  const latest = files.map((f) => join(CLIPS, f)).sort((a, b) => (a < b ? 1 : -1))[0]
  renameSync(latest, join(CLIPS, `${name}.webm`))
  console.log(`✓ ${name}.webm`)
}

const browser = await chromium.launch({ headless: true })

// login once, reuse the session
const loginCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
const lp = await loginCtx.newPage()
await lp.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
await lp.fill('input[type="email"]', EMAIL)
await lp.fill('input[type="password"]', PASS)
await lp.click('button[type="submit"]')
await lp.waitForURL(/\/dashboard/, { timeout: 20000 })
await lp.waitForTimeout(3000)
const state = await loginCtx.storageState()
await loginCtx.close()
console.log('logged in')

await recordClip(browser, state, '01-dashboard', '/dashboard', 11000, 2)
await recordClip(browser, state, '02-contacts', '/contacts', 10000, 2)
await recordClip(browser, state, '03-reviews', '/reviews', 11000, 2)
await recordClip(browser, state, '04-social', '/social', 10000, 2)

await browser.close()
console.log('done')
