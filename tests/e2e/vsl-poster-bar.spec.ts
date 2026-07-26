import { test, expect } from '@playwright/test'

// Hugo 2026-07-26: "that only when i click, i want it to be there even if i
// dont click" — the timing bar has to be readable on the poster, because the
// length is what decides whether they press play at all.
const PAGE = 'https://heyelsie.com/langley-services-electrical-contractors-ltd'

test.use({ viewport: { width: 390, height: 844 } })   // iPhone-ish

test('the timing bar and total length are visible before pressing play', async ({ page }) => {
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' })
  const bar = page.locator('.vbar')
  await expect(bar).toBeVisible()                      // NOT click-gated

  // the length must be real, not 0:00 — preload="metadata" gives us the duration
  const t = page.locator('#vt')
  await expect(t).toHaveText(/^0:00 \/ [1-9]\d?:\d\d$/, { timeout: 20000 })

  // and it must not be hidden behind the poster overlay
  const covered = await bar.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return !(el === top || el.contains(top))
  })
  expect(covered).toBe(false)

  await page.screenshot({ path: 'test-results/vsl-poster-bar.png' })
})
