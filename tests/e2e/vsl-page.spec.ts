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

    // Personalised headline + one button + scarcity line.
    await expect(page.locator('h1')).toContainText('I made a video for')
    await expect(page.locator('.cta')).toHaveCount(1)
    await expect(page.locator('.spots')).toContainText('left in')

    // OG tags are server-rendered for the SMS preview.
    const og = await page.locator('meta[property="og:title"]').getAttribute('content')
    expect(og).toContain('I made this video for')

    // The open beacon fired on load.
    await expect.poll(() => beacons).toContain('open')

    // CTA opens the tier sheet with the three plans + the £1 note.
    await page.locator('.cta').click()
    await expect(page.locator('.sheet')).toBeVisible()
    await expect(page.locator('.tier')).toHaveCount(3)
    await expect(page.locator('.pound')).toContainText('£1 today')
    await expect.poll(() => beacons).toContain('cta_click')
  })

  test('play opens the popup player; before/after cards sit below the button', async ({ page }) => {
    await page.goto(`/${SLUG}`)

    // The Mayfair before/after Google cards render below the buy button
    // (native HTML — shown whenever no proof image overrides them).
    await expect(page.locator('.ba .gcard')).toHaveCount(2)
    await expect(page.locator('.ba')).toContainText('Mayfair Plumbers')
    await expect(page.locator('.ba')).toContainText('(17)')
    await expect(page.locator('.ba')).toContainText('(356)')
    await expect(page.locator('.batag.blue')).toHaveText('AFTER')

    // Tapping the preview opens the fullscreen popup (the page itself never
    // expands); ✕ closes it and the preview is still there.
    await page.locator('#stage').click()
    await expect(page.locator('.vmodal')).toBeVisible()
    await expect(page.locator('.vmodal video')).toBeVisible()
    await page.locator('.vx').click()
    await expect(page.locator('.vmodal')).toBeHidden()
    await expect(page.locator('#stage')).toBeVisible()
  })

  test('unknown slug bounces to the marketing site', async ({ page }) => {
    const resp = await page.goto('/definitely-not-a-real-business-xyz')
    expect(resp?.url()).toContain('welcome')
  })
})
