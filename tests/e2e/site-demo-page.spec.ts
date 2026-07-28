import { test, expect } from '@playwright/test'

// The public demo site: heyelsie.com/s/{slug}
//
// Runs against a deployed environment with a seeded page:
//   SITE_DEMO_E2E_SLUG=hugo-test-plumbing E2E_BASE_URL=https://heyelsie.com
//
// Login-free by design. A plumber opens it on their phone straight from an SMS,
// so anything that needs a session is a bug, not a test gap.

const SLUG = process.env.SITE_DEMO_E2E_SLUG

test.describe('the demo site', () => {
  test.skip(!SLUG, 'SITE_DEMO_E2E_SLUG not set (needs a seeded page)')

  test('renders the business, fires an open beacon, and offers the phone everywhere', async ({ page }) => {
    const beacons: string[] = []
    await page.route('**/api/site-demo/track', async (route) => {
      const body = route.request().postData() || ''
      try { beacons.push(JSON.parse(body).type) } catch { /* ignore */ }
      await route.fulfill({ status: 200, body: '{"ok":true}' })
    })

    await page.goto(`/s/${SLUG}`)

    // The business name is the whole hero.
    const name = page.locator('h1.name')
    await expect(name).toBeVisible()
    await expect(name).not.toBeEmpty()

    // Three pillow bands. This is the composition the page cannot lose, and a
    // regression that clipped them to zero height shipped once already.
    await expect(page.locator('.pillow')).toHaveCount(3)
    for (const band of await page.locator('.pillow .plane').all()) {
      const box = await band.boundingBox()
      expect(box?.height ?? 0).toBeGreaterThan(80)
    }

    // Services render as a numbered index, never as cards.
    await expect(page.locator('.index .row').first()).toBeVisible()
    await expect(page.locator('.row .n').first()).toHaveText(/^\d\d$/)

    // A thumb can always find the phone.
    await expect(page.locator('a.callslab')).toBeVisible()
    expect(await page.locator('a[href^="tel:"]').count()).toBeGreaterThanOrEqual(3)

    await expect.poll(() => beacons, { timeout: 5000 }).toContain('open')
  })

  test('nothing is hidden if the entrance script never runs', async ({ page }) => {
    // The failure this guards against is the worst kind: a lead receives a
    // blank white page and we hear nothing about it.
    await page.addInitScript(() => {
      // @ts-expect-error deliberately breaking the observer
      delete window.IntersectionObserver
    })
    await page.goto(`/s/${SLUG}`)
    await expect(page.locator('h1.name')).toBeVisible()
    await expect(page.locator('.pillow .plane').first()).toBeVisible()
    await expect(page.locator('.index .row').first()).toBeVisible()
  })

  test('our own preview never burns the lead first touch', async ({ page }) => {
    const beacons: string[] = []
    await page.route('**/api/site-demo/track', async (route) => {
      beacons.push('any')
      await route.fulfill({ status: 200, body: '{"ok":true}' })
    })

    await page.goto(`/s/${SLUG}?p=1`)
    await expect(page.getByText('Internal preview')).toBeVisible()
    await page.waitForTimeout(1500)
    expect(beacons).toHaveLength(0)
  })

  test('is mobile first and never scrolls sideways', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 })
    await page.goto(`/s/${SLUG}`)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)
    await expect(page.locator('a.callbar')).toBeVisible()
  })
})
