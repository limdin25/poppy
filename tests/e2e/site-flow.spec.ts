import { test, expect } from '@playwright/test'

// The website sales flow canvas.
//
// Uses the shared signed-in state from tests/e2e/auth.setup.ts. The ladder save
// is asserted end to end, because a canvas whose edits do not persist is worse
// than no canvas: it would show timings that the cron is not using.

const PATH = '/admin/crm/site-flow'

test.describe('website flow canvas', () => {
  test('loads with no console errors and draws all eight stages', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('pageerror', (e) => errors.push(String(e)))

    await page.goto(PATH)
    await expect(page.getByTestId('site-flow-page')).toBeVisible()

    for (const stage of [
      'created', 'sent', 'opened', 'engaged',
      'nudged', 'ai_calling', 'checkout_sent', 'converted',
    ]) {
      await expect(page.getByTestId(`flow-node-${stage}`)).toBeVisible()
    }

    expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([])
  })

  test('clicking a stage opens the panel behind it', async ({ page }) => {
    await page.goto(PATH)
    await expect(page.getByTestId('flow-node-nudged')).toBeVisible()

    await page.getByTestId('flow-node-nudged').click()
    await expect(page.getByTestId('flow-panel')).toBeVisible()
    await expect(page.getByTestId('ladder-engage_1_minutes')).toBeVisible()

    await page.getByTestId('flow-panel-close').click()
    await expect(page.getByTestId('flow-panel')).toHaveCount(0)
  })

  test('a timing change saves and survives a reload', async ({ page }) => {
    await page.goto(PATH)
    await page.getByTestId('flow-node-nudged').click()

    const field = page.getByTestId('ladder-engage_1_minutes')
    await expect(field).toBeVisible()

    const save = page.getByTestId('ladder-save')
    // Two legitimate reasons the save control is absent:
    //  1. signed in as an agent rather than an admin, which is correct;
    //  2. running against `npm run dev`, where Vite does NOT execute the
    //     Vercel functions in api/ and /api/crm/site-flow returns the raw
    //     file, so the page never learns who is signed in.
    // Point E2E_BASE_URL at a deployment, or run `vercel dev`, to exercise it.
    // The save logic itself is covered by tests/site-demo-ladder-config.test.ts.
    if (!(await save.count())) {
      test.skip(true, 'save control unavailable: non-admin session, or api/ not served locally')
    }

    const original = await field.inputValue()
    const next = original === '15' ? '20' : '15'

    await field.fill(next)
    await save.click()
    await expect(page.getByTestId('ladder-saved')).toBeVisible()

    await page.reload()
    await page.getByTestId('flow-node-nudged').click()
    await expect(page.getByTestId('ladder-engage_1_minutes')).toHaveValue(next)

    // Put it back so the next run starts from where it found things.
    await page.getByTestId('ladder-engage_1_minutes').fill(original)
    await page.getByTestId('ladder-save').click()
    await expect(page.getByTestId('ladder-saved')).toBeVisible()
  })

  test('keeps the canvas scrolling inside its own box on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 })
    await page.goto(PATH)
    await expect(page.getByTestId('site-flow-page')).toBeVisible()

    // The canvas is ~980px wide and must scroll INSIDE its container rather
    // than widening the page. Asserted against this component's own box, not
    // against documentElement: the CRM shell already overflows by ~141px at
    // 390px on every page (Pipelines and Video funnel do the same), so a
    // documentElement assertion would be measuring a pre-existing shell issue
    // rather than anything this page controls.
    const own = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="site-flow-page"]') as HTMLElement
      return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }
    })
    expect(own.scrollWidth - own.clientWidth).toBeLessThanOrEqual(1)

    // and the inner container really is the thing that scrolls
    const canvasScrolls = await page.evaluate(() => {
      const el = document.querySelector('.react-flow')?.parentElement?.parentElement as HTMLElement
      return el ? el.scrollWidth > el.clientWidth : false
    })
    expect(canvasScrolls).toBe(true)
  })
})
