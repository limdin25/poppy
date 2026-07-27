// Captures the client website's MOBILE version as a crisp full-page PNG
// (390 CSS px iPhone viewport @2x = 780px-wide image). The scroll itself is
// animated in Remotion so it can be timed to the voice exactly.
//
// Usage: node video/capture-mobile-site.mjs [url] [outPath]
//   defaults keep the original sample capture behaviour.
// Writes <outPath>.json with { imageHeight } (px in the 780-wide space) —
// prep-lead.mjs feeds it to OpeningWebsiteV's scroll clamp.
//
// Hugo 2026-07-27: "the system must recognise when the website's not open. You
// cannot just go blind. Recognise and then has a fallback."
//
// It used to goto() and screenshot whatever came back. A Cloudflare interstitial
// answers 200 with a real DOM, so "Just a moment..." or "Attention Required"
// would be captured and posted into the lead's own personalised video. That is
// worse than having no website scene at all: we would be showing a plumber a
// video of their site being broken by us. Now the capture VALIDATES what it got,
// retries once through a UK residential proxy (many small trade sites sit behind
// Cloudflare and challenge datacentre IPs), and exits non-zero with a reason so
// prep-lead.mjs falls back to the Google-search opening.
//
// Proxy is opt-in via env, never hardcoded:
//   SITE_PROXY_SERVER=http://geo.iproyal.com:12321
//   SITE_PROXY_USERNAME=... SITE_PROXY_PASSWORD=...
//
// Gotchas (learned on real sites): use `www.` + domcontentloaded — bare
// domain / networkidle can die with ERR_CONNECTION_CLOSED; the cookie-banner
// removal only matches containers containing the literal "We use cookies",
// other consent wordings survive — eyeball each capture.
import { chromium, devices } from 'playwright'
import { writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { safeWebsiteUrl } from './scripts/lead-url.mjs'

const dir = dirname(fileURLToPath(import.meta.url))
const RAW_URL = process.argv[2] || 'https://www.theboilerclubonline.co.uk/'
const OUT = process.argv[3] || join(dir, 'public', 'client-mobile.png')

// SSRF guard (adversarial review 2026-07-26): the URL comes from an
// agent-editable lead field and this runs as root. Reject anything that isn't
// a safe PUBLIC http(s) website BEFORE the browser ever touches it. Both the
// primary and the retry use only this validated URL — never the raw value.
const safe = safeWebsiteUrl(RAW_URL)
if (!safe) {
  console.error(`refusing to capture unsafe/non-public URL: ${RAW_URL}`)
  process.exit(2)
}
const url = safe
// resilient variant: try www. first, fall back to the bare validated host
const wwwUrl = /^https:\/\/www\./.test(url) ? url : url.replace(/^https:\/\//, 'https://www.')

const PROXY = process.env.SITE_PROXY_SERVER
  ? {
      server: process.env.SITE_PROXY_SERVER,
      ...(process.env.SITE_PROXY_USERNAME ? { username: process.env.SITE_PROXY_USERNAME } : {}),
      ...(process.env.SITE_PROXY_PASSWORD ? { password: process.env.SITE_PROXY_PASSWORD } : {}),
    }
  : null

/** Is what we just loaded actually their website, or something standing in
 *  front of it? Runs in the page so it sees the rendered DOM, not the raw HTML:
 *  a challenge page is JS-driven and looks fine to curl. */
async function looksWrong(page) {
  return page.evaluate(() => {
    const title = (document.title || '').toLowerCase()
    const text = (document.body?.innerText || '').trim()
    const low = text.toLowerCase()
    const height = document.body ? document.body.scrollHeight : 0

    // Unambiguous. No plumber's homepage says these.
    const WALL = [
      'just a moment', 'attention required', 'checking your browser',
      'enable javascript and cookies', 'verify you are human',
      'please turn javascript on', 'ddos protection by', 'cf-browser-verification',
      'access denied', 'error 1020', 'error 1015', 'cloudflare ray id',
      'you have been blocked', 'sorry, you have been blocked',
    ]
    for (const p of WALL) if (title.includes(p) || low.includes(p)) return `blocked (${p})`

    // Could appear inside real copy, so only trust them in the TITLE or on a
    // page with almost nothing else on it.
    const DEAD = [
      'account suspended', 'site suspended', 'domain is for sale', 'buy this domain',
      'domain parked', 'this domain is parked', 'coming soon', 'under construction',
      'bad gateway', 'service unavailable', '502', '503', '404 not found',
      'index of /', 'default web page', 'welcome to nginx', 'apache2 ubuntu default',
    ]
    for (const p of DEAD) {
      if (title.includes(p) || (low.includes(p) && text.length < 600)) return `dead site (${p})`
    }

    // Nothing rendered. Either JS never settled or there is no site here.
    if (text.length < 120 && height < 900) {
      return `near-empty page (${text.length} chars, ${height}px tall)`
    }
    return null
  })
}

/** One capture attempt. Returns { ok, reason?, size? } and always closes its
 *  own browser, so a failed direct attempt cannot leak a process into the
 *  proxy retry. */
async function attempt(label, proxy) {
  const browser = await chromium.launch({ headless: true, ...(proxy ? { proxy } : {}) })
  try {
    const ctx = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 2 })
    const page = await ctx.newPage()

    // Try www. first, then the bare host. BOTH the throw and a bad STATUS have
    // to fall through: cleanbluewater.uk answers 522 on www. and 200 on the bare
    // domain, and the old code only retried on a throw. A 522 does not throw, it
    // returns a perfectly screenshottable Cloudflare error page, which is how a
    // real lead's video ended up showing their site as broken (Hugo 2026-07-27).
    let last = 'no attempt'
    let landed = false
    for (const candidate of [wwwUrl, url]) {
      let res = null
      try {
        res = await page.goto(candidate, { waitUntil: 'domcontentloaded', timeout: 60000 })
      } catch (e) {
        last = (e && e.message ? e.message : String(e)).split('\n')[0].slice(0, 120)
        continue
      }
      const status = res ? res.status() : 0
      if (status >= 400) { last = `http ${status}`; continue }

      await page.waitForTimeout(3000)
      const wrong = await looksWrong(page)
      if (wrong) { last = wrong; continue }
      landed = true
      break
    }
    if (!landed) return { ok: false, reason: last }

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
    console.log(`captured via ${label}`, OUT, 'viewport', size)
    return { ok: true, size }
  } catch (e) {
    return { ok: false, reason: (e && e.message ? e.message : String(e)).slice(0, 160) }
  } finally {
    await browser.close().catch(() => {})
  }
}

let r = await attempt('direct', null)

// One retry through a UK residential exit. Small trade sites are overwhelmingly
// Cloudflare-fronted and a datacentre IP is the thing being challenged, so the
// same request from a residential address usually just works.
if (!r.ok && PROXY) {
  console.error(`direct capture failed (${r.reason}) — retrying through the residential proxy`)
  r = await attempt('proxy', PROXY)
}

if (!r.ok) {
  // Non-zero on purpose: prep-lead.mjs catches this and swaps in the
  // Google-search opening, which is the honest scene for a site we cannot show.
  console.error(`site capture failed: ${r.reason}${PROXY ? '' : ' (no SITE_PROXY_SERVER configured, so no residential retry was possible)'}`)
  process.exit(3)
}

// image px = CSS px × 2 (deviceScaleFactor); the comp works in 780-wide space
writeFileSync(`${OUT}.json`, JSON.stringify({ imageHeight: r.size.h * 2, cssHeight: r.size.h, url }))
console.log('saved', OUT)
