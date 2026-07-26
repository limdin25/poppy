import { test, expect } from '@playwright/test'

// VSL public page (Hugo 2026-07-25). Runs against production with a seeded
// test page:  VSL_E2E_SLUG=hugo-test-plumbing E2E_BASE_URL=https://heyelsie.com
// The page is login-free by design — a plumber's phone opens it straight
// from the SMS.

const SLUG = process.env.VSL_E2E_SLUG

test.describe('heyelsie.com/{slug} — the video page', () => {
  test.skip(!SLUG, 'VSL_E2E_SLUG not set (needs a seeded page)')

  test('renders personalised, fires beacons, opens the tier sheet', async ({ page }) => {
    const beacons: string[] = []
    await page.route('**/api/vsl/track', async (route) => {
      const body = route.request().postData() || ''
      beacons.push(JSON.parse(body).type)
      await route.fulfill({ status: 200, body: '{"ok":true}' })
    })

    await page.goto(`/${SLUG}`)

    // Personalised headline + the main button (plus its copy under the
    // calculator) + scarcity line.
    await expect(page.locator('h1')).toContainText('I made a video for')
    await expect(page.locator('.cta')).toHaveCount(2)
    await expect(page.locator('.spots')).toContainText('left in')

    // OG tags are server-rendered for the SMS preview.
    const og = await page.locator('meta[property="og:title"]').getAttribute('content')
    expect(og).toContain('I made this video for')

    // The open beacon fired on load.
    await expect.poll(() => beacons).toContain('open')

    // CTA opens the tier sheet with the three plans + the £1 note.
    await page.locator('.cta').first().click()
    await expect(page.locator('.sheet')).toBeVisible()
    await expect(page.locator('.tier')).toHaveCount(3)
    await expect(page.locator('.pound')).toContainText('£1 today')
    await expect.poll(() => beacons).toContain('cta_click')
  })

  test('play opens the popup player; before/after cards sit below the button', async ({ page }) => {
    await page.goto(`/${SLUG}`)

    // Proof below the buy button: before/after example rows (Mayfair first,
    // then real same-niche businesses) — unless an admin set proof_image_url,
    // which swaps in an image instead. Assert whichever variant renders.
    const imageProof = await page.locator('.proof img').count()
    if (imageProof) {
      await expect(page.locator('.proof img')).toBeVisible()
    } else {
      await expect(page.locator('.ba .barow').first()).toBeVisible()
      expect(await page.locator('.ba .gcard').count()).toBeGreaterThanOrEqual(2)
      await expect(page.locator('.ba')).toContainText('Examples of businesses')
      await expect(page.locator('.ba')).toContainText('Mayfair Plumbers')
      await expect(page.locator('.ba')).toContainText('(17)')
      await expect(page.locator('.ba')).toContainText('(356)')
      await expect(page.locator('.ba')).toContainText('more calls a month')
      await expect(page.locator('.batag.blue')).toHaveText('AFTER')
    }

    // Tapping the preview opens the fullscreen popup (the page itself never
    // expands); ✕ closes it and the preview is still there.
    await page.locator('#stage').click()
    await expect(page.locator('.vmodal')).toBeVisible()
    await expect(page.locator('.vmodal video')).toBeVisible()
    await page.locator('.vx').click()
    await expect(page.locator('.vmodal')).toBeHidden()
    await expect(page.locator('#stage')).toBeVisible()
  })

  test('value calculator computes, animates and fires its beacon once', async ({ page }) => {
    const beacons: string[] = []
    await page.route('**/api/vsl/track', async (route) => {
      beacons.push(JSON.parse(route.request().postData() || '{}').type)
      await route.fulfill({ status: 200, body: '{"ok":true}' })
    })
    await page.goto(`/${SLUG}`)

    const calc = page.locator('.calc')
    await calc.scrollIntoViewIfNeeded()
    await expect(page.locator('#cv')).toHaveText('£18,000') // 300 × 5 × 12
    await expect(page.locator('#cn')).toContainText("4 extra jobs in a year covers it — that's one every three months.")

    // drag the slider to 8 → £28,800; the beacon fires once
    await page.locator('#njs').fill('8')
    await expect(page.locator('#nj')).toHaveText('8')
    await expect(page.locator('#cv')).toHaveText('£28,800')
    await expect.poll(() => beacons.filter((b) => b === 'calc').length).toBe(1)

    // £100 jobs → £9,600 a year, break-even 12 (no three-months tail)
    await page.locator('#jv').fill('100')
    await expect(page.locator('#cv')).toHaveText('£9,600')
    await expect(page.locator('#cn')).toContainText('12 extra jobs in a year covers it.')
    await expect(page.locator('#cn')).not.toContainText('three months')
    expect(beacons.filter((b) => b === 'calc').length).toBe(1) // still once

    // the second CTA under the calculator opens the tier sheet
    await page.locator('.cta2').click()
    await expect(page.locator('.sheet')).toBeVisible()
  })

  test('unknown slug bounces to the marketing site', async ({ page }) => {
    const resp = await page.goto('/definitely-not-a-real-business-xyz')
    expect(resp?.url()).toContain('welcome')
  })
})
