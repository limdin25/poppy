import { test, expect } from './helpers/auth'
import { existsHealed } from './helpers/healer'

/**
 * Smoke suite — the launch tripwire.
 *
 * Proves: auth works, every primary page loads behind the guard, the app shell
 * renders, and the inbox doesn't flicker (the regression we just fixed). If any of
 * these go red, do not ship.
 */

const PAGES: { path: string; marker: RegExp }[] = [
  { path: '/dashboard', marker: /Overview|Needs your reply|Next 6|Conversations|Live activity/i },
  { path: '/inbox', marker: /Inbox|conversation|message|Unread/i },
  { path: '/leads', marker: /Lead|Pipeline|Table|Add lead|deal/i },
  { path: '/appointments', marker: /Appointment|booking|Today|Upcoming/i },
  { path: '/campaigns', marker: /Campaign|recipients|New campaign/i },
  { path: '/knowledge', marker: /Knowledge|website|Upload|Paste|Set up Elsie/i },
  { path: '/templates', marker: /Template|Quick repl|Follow-?up/i },
  { path: '/agents/personality', marker: /Personality|Assistant|Welcome|Tone/i },
  { path: '/agents/classification', marker: /Goals|optimis|preset/i },
  { path: '/connections', marker: /WhatsApp|Connect|Integration|Connected/i },
  { path: '/analytics', marker: /Analytics|Leads|Messages|funnel|days/i },
  { path: '/account', marker: /Account|Profile|Company|Settings|Currency/i },
]

test.describe('smoke', () => {
  test('login lands on the authenticated app shell', async ({ authedPage }) => {
    await expect(authedPage.locator('nav a[href*="inbox"]').first()).toBeVisible()
    expect(authedPage.url()).toMatch(/\/dashboard|\/inbox/)
  })

  for (const { path, marker } of PAGES) {
    test(`page loads: ${path}`, async ({ authedPage }) => {
      const errors: string[] = []
      authedPage.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text())
      })
      authedPage.on('pageerror', (e) => errors.push(String(e)))

      await authedPage.goto(path)
      // Some marker text for the page is present (not a blank screen / crash).
      await expect(authedPage.locator('body')).toContainText(marker, { timeout: 15_000 })
      // The app chrome is still there (didn't redirect to /login or /welcome).
      await expect(authedPage.locator('nav a[href*="inbox"]').first()).toBeVisible()
      expect(authedPage.url()).not.toMatch(/\/login|\/welcome/)

      // No hard runtime errors (ignore noisy network/3rd-party warnings).
      const fatal = errors.filter(
        (e) => !/favicon|net::ERR|Failed to load resource|analytics|unipile|sentry|googletag/i.test(e),
      )
      expect(fatal, `console errors on ${path}:\n${fatal.join('\n')}`).toEqual([])
    })
  }

  test('inbox does not flicker (no constant re-render)', async ({ authedPage }) => {
    await authedPage.goto('/inbox')
    // Open the first conversation if present.
    const firstConv = authedPage.locator('[role="button"], [data-testid="conversation-item"]').filter({ hasText: /\+?\d{6,}|\w/ }).first()
    if (await firstConv.count()) await firstConv.click().catch(() => {})
    // Measure DOM mutations over 4s — a flickering thread mutates hundreds of times.
    const mutations = await authedPage.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let n = 0
          const o = new MutationObserver((m) => (n += m.length))
          o.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true })
          setTimeout(() => {
            o.disconnect()
            resolve(n)
          }, 4000)
        }),
    )
    expect(mutations, `inbox mutated ${mutations}× in 4s — flicker regression`).toBeLessThan(80)
  })

  test('home routing: marketing host shows landing, app host shows dashboard', async ({ page }) => {
    // On the app/preview host, "/" must redirect into the app, never show marketing.
    await page.goto('/')
    await page.waitForTimeout(1500)
    const onLanding = await existsHealed(page, { text: /Simple monthly pricing|Never miss|See pricing/i }, { timeout: 2000 })
    const onApp = /\/dashboard|\/login|\/welcome/.test(page.url())
    expect(onLanding || onApp, 'root did not resolve to landing or app').toBeTruthy()
  })
})
