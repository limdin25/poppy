import { test, expect } from './helpers/auth'

/**
 * "Viewing as Marr" must show ONLY Marr's videos — Hugo 2026-07-27, after
 * seeing all 14 pages (including his own test videos) while impersonating.
 *
 * The board always sent the filtered query. It also sent an UNFILTERED one,
 * and whichever answered last won, so this reproduced only sometimes. The
 * network assertion below is the one that actually catches it: counting cards
 * passes half the time even when the bug is present.
 */

const MARR = { id: '7b677273-f330-43c7-b21a-6242d6f8881a', name: 'Marr Roland Servidor' }

test('the board never issues an unfiltered query while impersonating', async ({ authedPage: page }) => {
  const pageQueries: string[] = []
  page.on('request', (r) => {
    const u = r.url()
    if (u.includes('/wk_vsl_pages?')) pageQueries.push(u)
  })

  await page.goto('/admin/crm/video-funnel')
  await page.evaluate((a) => {
    localStorage.setItem('crm_view_as', JSON.stringify({ id: a.id, name: a.name }))
  }, MARR)
  await page.reload()

  // Give the auth re-resolve that used to fire the second query time to happen.
  await page.waitForTimeout(9000)

  expect(pageQueries.length).toBeGreaterThan(0)
  const unfiltered = pageQueries.filter((u) => !u.includes(MARR.id))
  expect(unfiltered, `unfiltered board queries:\n${unfiltered.join('\n')}`).toHaveLength(0)
})

test('every card on the board belongs to the agent being viewed as', async ({ authedPage: page }) => {
  await page.goto('/admin/crm/video-funnel')
  await page.evaluate((a) => {
    localStorage.setItem('crm_view_as', JSON.stringify({ id: a.id, name: a.name }))
  }, MARR)
  await page.reload()
  await page.locator('[data-testid^="funnel-card-"]').first().waitFor({ timeout: 20_000 })
  await page.waitForTimeout(6000) // let any late fetch land

  const owners = new Set(
    (await page.getByTestId('agent-chip').allTextContents()).map((t) => t.trim()),
  )
  expect([...owners].join(' | ')).not.toMatch(/Hugo|Pedro/)
})
