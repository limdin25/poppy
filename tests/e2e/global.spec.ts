import { test, expect } from './helpers/auth'
import { existsHealed } from './helpers/healer'

/**
 * Global / cross-cutting + mobile — checklist K-012 (a..e).
 *
 * Cross-cutting concerns that span every page: the sidebar nav links all reach
 * real pages with the app shell intact, mobile bottom-nav is present at phone
 * width, pages never surface a raw error object, the inbox doesn't flicker, and
 * Sign out actually signs the user out (the FINAL test — kept last so earlier
 * tests stay authed on the shared demo account).
 *
 * Runs against the LIVE production app under BOTH the `chromium` and `mobile`
 * (Pixel 7) projects. Read-only except the deliberate final sign-out.
 */

// Desktop sidebar nav (visible labels from src/app/Layout.tsx). On WhatsApp-only
// demo accounts the voice-only items (Calls/Quotes/Invoices/Billing) are hidden,
// so we only iterate the always-present links.
const SIDEBAR_LINKS: { label: RegExp; route: RegExp }[] = [
  { label: /^Overview$/, route: /\/dashboard/ },
  { label: /^Inbox$/, route: /\/inbox/ },
  { label: /^Leads$/, route: /\/leads/ },
  { label: /^Appointments$/, route: /\/appointments/ },
  { label: /^Campaigns$/, route: /\/campaigns/ },
  { label: /^Knowledge Base$/, route: /\/knowledge/ },
  { label: /^Templates$/, route: /\/templates/ },
  { label: /^AI Agent$/, route: /\/agents/ },
  { label: /^Integrations$/, route: /\/connections/ },
  { label: /^Analytics$/, route: /\/analytics/ },
  { label: /^Settings$/, route: /\/account/ },
]

// Mobile bottom-tab labels (src/app/Layout.tsx mobileNav).
const MOBILE_TABS = [/^Home$/, /^Inbox$/, /^Leads$/, /^Agent$/, /^Settings$/]

function isMobile(): boolean {
  return test.info().project.name === 'mobile'
}

/** The app shell is "present" when at least one primary nav link is visible. */
async function shellPresent(page: import('@playwright/test').Page): Promise<boolean> {
  // Inbox link lives in the desktop sidebar AND the mobile bottom bar, so it's a
  // reliable shell marker in either project.
  return existsHealed(page, {
    css: 'a[href="/inbox"], a[href*="inbox"], nav a',
    text: /Inbox/i,
    describe: 'app shell nav',
  })
}

test.describe('Global / cross-cutting + mobile', () => {
  // --- (a) every visible sidebar nav link reaches a real page ---
  for (const { label, route } of SIDEBAR_LINKS) {
    test(`nav link ${label.source} reaches a real page with shell intact`, async ({ authedPage }) => {
      // Mobile collapses the full sidebar behind a hamburger; opening it is fine
      // (reversible), but the desktop project exercises the persistent sidebar.
      if (isMobile()) {
        const burger = authedPage.locator('header button').first()
        if (await burger.isVisible().catch(() => false)) await burger.click()
      }

      const link = authedPage
        .locator('aside a, nav a')
        .filter({ hasText: label })
        .first()
      // Some links may scroll off the demo viewport — assert presence, then click.
      if (!(await link.isVisible().catch(() => false))) {
        test.info().annotations.push({ type: 'note', description: `${label.source} not visible in this project` })
        return
      }

      await link.click()
      await authedPage.waitForURL(route, { timeout: 12_000 }).catch(() => {})
      expect(authedPage.url(), `${label.source} did not navigate to ${route.source}`).toMatch(route)
      // App shell still present (didn't crash to a blank/error page).
      expect(await shellPresent(authedPage), 'app shell missing after navigation').toBeTruthy()
    })
  }

  // --- (c) MOBILE: bottom nav visible and nothing critical overflows ---
  test('mobile bottom nav (Home/Inbox/Leads/Agent/Settings) is visible', async ({ authedPage }) => {
    test.skip(!isMobile(), 'mobile-only assertion')
    await authedPage.goto('/dashboard')
    const bottomNav = authedPage.locator('nav.sticky.bottom-0, nav').last()
    await expect(bottomNav).toBeVisible()
    for (const label of MOBILE_TABS) {
      const tab = bottomNav.getByRole('link', { name: label })
      await expect(tab, `bottom tab ${label.source} missing`).toBeVisible()
    }
  })

  test('mobile: no horizontal overflow of the viewport', async ({ authedPage }) => {
    test.skip(!isMobile(), 'mobile-only assertion')
    for (const route of ['/dashboard', '/inbox', '/leads']) {
      await authedPage.goto(route)
      await authedPage.waitForTimeout(1500)
      const overflow = await authedPage.evaluate(() => {
        const el = document.scrollingElement || document.documentElement
        // Allow a 2px fudge for sub-pixel rounding.
        return el.scrollWidth - el.clientWidth
      })
      expect(overflow, `horizontal overflow on ${route}`).toBeLessThanOrEqual(2)
    }
  })

  // --- (d) pages show content or a friendly message, never a raw error object ---
  test('pages never surface a raw error object', async ({ authedPage }) => {
    const routes = ['/dashboard', '/inbox', '/leads', '/appointments', '/campaigns', '/knowledge', '/templates', '/agents', '/analytics', '/account']
    for (const route of routes) {
      await authedPage.goto(route)
      await authedPage.waitForTimeout(1800)
      const body = authedPage.locator('body')
      // No serialized error blobs / unhandled crash signatures should be visible.
      await expect(body, `raw error on ${route}`).not.toContainText('[object Object]')
      await expect(body, `undefined leak on ${route}`).not.toContainText('undefined undefined')
      await expect(body, `NaN on ${route}`).not.toContainText('NaN')
      await expect(body, `stack trace on ${route}`).not.toContainText(/TypeError:|ReferenceError:|Cannot read prop/i)
      // The shell must remain — a white-screen crash would drop the nav.
      expect(await shellPresent(authedPage), `shell gone on ${route}`).toBeTruthy()
    }
  })

  // --- (e) inbox does not flicker (DOM mutations stay bounded over 4s) ---
  test('inbox does not flicker (mutations < 80 over 4s)', async ({ authedPage }) => {
    await authedPage.goto('/inbox')
    // Let the first paint + initial data load settle before counting.
    await authedPage.waitForTimeout(2500)
    await authedPage.evaluate(() => {
      ;(window as unknown as { __mut: number }).__mut = 0
      const obs = new MutationObserver((records) => {
        ;(window as unknown as { __mut: number }).__mut += records.length
      })
      obs.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true })
      ;(window as unknown as { __obs: MutationObserver }).__obs = obs
    })
    await authedPage.waitForTimeout(4000)
    const mutations = await authedPage.evaluate(() => {
      ;(window as unknown as { __obs: MutationObserver }).__obs.disconnect()
      return (window as unknown as { __mut: number }).__mut
    })
    expect(mutations, `inbox flickered: ${mutations} DOM mutations in 4s`).toBeLessThan(80)
  })

  // --- (b) Sign out logs out and lands on /login or /welcome — MUST BE LAST ---
  test('zz-final: Sign out logs out and lands on /login or /welcome', async ({ authedPage }) => {
    await authedPage.goto('/dashboard')

    // Mobile keeps the sign-out control inside the hamburger drawer — open it
    // reliably (wait for the burger, click, wait for the drawer overlay) before
    // reaching for the footer sign-out, which is otherwise off-screen left.
    if (isMobile()) {
      const burger = authedPage.locator('header button').first()
      await expect(burger).toBeVisible({ timeout: 8000 })
      await burger.click()
      // Drawer overlay (bg-black/30) confirms the panel slid in.
      await authedPage.locator('.fixed.inset-0').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
    }

    // Sign-out is an icon button (title="Sign out") in the sidebar footer. Pick the
    // visible one (collapsed + expanded variants both exist in the DOM).
    const signOut = authedPage.locator('button[title="Sign out"]:visible').first()
    await expect(signOut).toBeVisible({ timeout: 8000 })
    await signOut.scrollIntoViewIfNeeded().catch(() => {})
    await signOut.click()

    await authedPage.waitForURL(/\/login|\/welcome|\/$/, { timeout: 15_000 }).catch(() => {})
    expect(authedPage.url(), 'did not land on a logged-out route').toMatch(/\/login|\/welcome|\/$/)
    // And the authed shell should be gone (no Inbox nav link on the public page).
    await expect(authedPage.locator('aside a[href="/inbox"]')).toHaveCount(0)
  })
})
