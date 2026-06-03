import type { Page, Locator } from '@playwright/test'

/**
 * Self-healing locator.
 *
 * The problem with brittle e2e tests: one renamed class or moved data-testid and a
 * whole spec goes red even though the feature works. `heal()` instead describes the
 * element by *intent* and tries several strategies in priority order:
 *
 *   1. data-testid   (most stable — preferred)
 *   2. ARIA role + accessible name
 *   3. form label / placeholder
 *   4. visible text
 *   5. raw CSS (last resort)
 *
 * It returns the first strategy that actually resolves to a visible element, and
 * records which strategy won in HEAL_LOG. If the preferred testid is missing but a
 * fallback succeeds, the test still passes AND we get a console warning telling us
 * which testid to add — the suite "heals" itself and tells us how to harden it.
 */

export interface Intent {
  /** Preferred: data-testid value. */
  testid?: string
  /** ARIA role + optional accessible name, e.g. { type: 'button', name: /save/i }. */
  role?: { type: Parameters<Page['getByRole']>[0]; name?: string | RegExp; exact?: boolean }
  /** Associated <label> text. */
  label?: string | RegExp
  /** Input placeholder. */
  placeholder?: string | RegExp
  /** Visible text content. */
  text?: string | RegExp
  /** Raw CSS selector — last resort. */
  css?: string
  /** Human description for logs/errors. */
  describe?: string
}

export interface HealEvent {
  intent: string
  strategyTried: string[]
  strategyWon: string | null
  healed: boolean
}

export const HEAL_LOG: HealEvent[] = []

function describe(intent: Intent): string {
  return (
    intent.describe ||
    intent.testid ||
    (intent.role && `${intent.role.type}:${intent.role.name ?? ''}`) ||
    String(intent.text || intent.label || intent.placeholder || intent.css || 'unknown')
  )
}

function candidates(page: Page, intent: Intent): { name: string; loc: Locator }[] {
  const out: { name: string; loc: Locator }[] = []
  if (intent.testid) out.push({ name: `testid=${intent.testid}`, loc: page.getByTestId(intent.testid) })
  if (intent.role)
    out.push({
      name: `role=${intent.role.type}`,
      loc: page.getByRole(intent.role.type, { name: intent.role.name, exact: intent.role.exact }),
    })
  if (intent.label) out.push({ name: 'label', loc: page.getByLabel(intent.label) })
  if (intent.placeholder) out.push({ name: 'placeholder', loc: page.getByPlaceholder(intent.placeholder) })
  if (intent.text) out.push({ name: 'text', loc: page.getByText(intent.text) })
  if (intent.css) out.push({ name: `css=${intent.css}`, loc: page.locator(intent.css) })
  return out
}

/**
 * Resolve an Intent to a Locator, trying strategies in order until one is visible.
 * Polls up to `timeout` ms. Throws a descriptive error if nothing matches.
 */
export async function heal(page: Page, intent: Intent, opts: { timeout?: number } = {}): Promise<Locator> {
  const timeout = opts.timeout ?? 5000
  const cands = candidates(page, intent)
  if (cands.length === 0) throw new Error(`heal(): empty intent for "${describe(intent)}"`)

  const deadline = Date.now() + timeout
  let lastErr = ''
  while (Date.now() < deadline) {
    for (const c of cands) {
      try {
        const first = c.loc.first()
        if ((await first.count()) > 0 && (await first.isVisible())) {
          const preferred = cands[0].name
          const healed = c.name !== preferred
          HEAL_LOG.push({
            intent: describe(intent),
            strategyTried: cands.map((x) => x.name),
            strategyWon: c.name,
            healed,
          })
          if (healed) {
            // eslint-disable-next-line no-console
            console.warn(
              `[heal] "${describe(intent)}" fell back to ${c.name} (preferred ${preferred} not found — consider adding data-testid).`,
            )
          }
          return first
        }
      } catch (e) {
        lastErr = String(e)
      }
    }
    await page.waitForTimeout(150)
  }
  HEAL_LOG.push({ intent: describe(intent), strategyTried: cands.map((x) => x.name), strategyWon: null, healed: false })
  throw new Error(
    `heal(): could not locate "${describe(intent)}" via [${cands.map((c) => c.name).join(', ')}] within ${timeout}ms. ${lastErr}`,
  )
}

/** Convenience: heal + click. */
export async function clickHealed(page: Page, intent: Intent, opts?: { timeout?: number }): Promise<void> {
  const loc = await heal(page, intent, opts)
  await loc.click()
}

/** Convenience: heal + fill (clears first). */
export async function fillHealed(page: Page, intent: Intent, value: string, opts?: { timeout?: number }): Promise<void> {
  const loc = await heal(page, intent, opts)
  await loc.fill(value)
}

/** True if any element matching the intent is present & visible (no throw). */
export async function existsHealed(page: Page, intent: Intent, opts: { timeout?: number } = {}): Promise<boolean> {
  try {
    await heal(page, intent, { timeout: opts.timeout ?? 2500 })
    return true
  } catch {
    return false
  }
}

/** Summary of which intents needed healing — useful in an afterAll reporter. */
export function healSummary(): { total: number; healed: number; failed: number; details: HealEvent[] } {
  return {
    total: HEAL_LOG.length,
    healed: HEAL_LOG.filter((e) => e.healed).length,
    failed: HEAL_LOG.filter((e) => !e.strategyWon).length,
    details: HEAL_LOG,
  }
}
