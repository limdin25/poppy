// Captures the two real-world assets for v8:
//  1. Real plumber homepage video (The Boiler Club, Glossop) — opening bg
//  2. Real Google support page (answer/7091) full-page screenshot with the
//     "More reviews and positive ratings" quote highlighted + its position
// Usage: node capture-v8-assets.mjs
import { chromium } from 'playwright'
import { writeFileSync } from 'fs'

const browser = await chromium.launch({ headless: true })

// 1. real plumber homepage, ~9s slow settle+scroll
{
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: 'public/clips', size: { width: 1920, height: 1080 } },
  })
  const p = await ctx.newPage()
  await p.goto('https://www.theboilerclubonline.co.uk/', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await p.waitForTimeout(4000)
  for (let i = 0; i < 4; i++) {
    await p.mouse.wheel(0, 70 + Math.random() * 60)
    await p.waitForTimeout(900 + Math.random() * 600)
  }
  await p.mouse.wheel(0, -120)
  await p.waitForTimeout(1200)
  await ctx.close()
  console.log('✓ website clip')
}

// 2. real Google support page, quote highlighted, full-page screenshot + position
{
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1000 } })
  const p = await ctx.newPage()
  await p.goto('https://support.google.com/business/answer/7091?hl=en-GB', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await p.waitForTimeout(2500)
  // hide cookie/consent overlays if present
  await p.evaluate(() => {
    document.querySelectorAll('[aria-modal="true"], .gb_Ha, .consent-bump, form[action*="consent"]').forEach((el) => el.remove())
    document.body.style.overflow = 'auto'
  })
  const info = await p.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let node
    while ((node = walker.nextNode())) {
      if (node.textContent.includes('More reviews and positive ratings')) {
        const el = node.parentElement
        const block = el.closest('li, p, div')
        const target = block || el
        target.style.cssText += 'background:#fff3a3;outline:4px solid #fbbc04;border-radius:6px;padding:6px 10px;box-shadow:0 2px 14px rgba(0,0,0,0.18)'
        const r = target.getBoundingClientRect()
        return { y: r.top + window.scrollY, h: r.height, x: r.left, w: r.width }
      }
    }
    return null
  })
  console.log('quote position:', JSON.stringify(info))
  await p.screenshot({ path: 'out/probe/support-full.png', fullPage: true })
  const shot = await p.screenshot({ path: 'public/support-page.png', fullPage: true })
  writeFileSync('src/data/support-quote.json', JSON.stringify(info ?? { y: 0, h: 100, x: 0, w: 800 }))
  await ctx.close()
  console.log('✓ support page screenshot')
}

await browser.close()
