// The Deal Cockpit, in a real browser.
//
// THIS SPEC NEVER COMMITS AN ACTION AND NEVER SENDS AN EMAIL. It walks up to
// the gate, checks the gate holds, and presses Escape. Everything on this page
// reaches a real estate agent, so an e2e run must not be able to ring one or
// write to one.
//
// The promise it exists to hold is the ordering: the most urgent deal in the
// business is at the top, and that has to be true whether the deal brain is on,
// off, capped or broken, because when it is off the order is computed by code.

// The cockpit sits behind CrmGuard (wk_is_agent_or_admin), and the shared demo
// account is a RECEPTIONIST demo, not a CRM agent, so it correctly gets "CRM
// access required". Credentials come from env for the same reason every other
// prod spec in this repo does it: this repo mirrors to a PUBLIC GitHub repo, so
// a working password must never be committed.
//
//   E2E_CRM_EMAIL=... E2E_CRM_PASSWORD=... \
//   E2E_BASE_URL=https://elsie-preview.vercel.app \
//   npx playwright test deal-cockpit
//
// Skips cleanly when they are not set, so a run without the secret stays green
// rather than reporting eight failures that mean nothing.

import { test, expect } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

const COCKPIT = '/admin/crm/cockpit';
const EMAIL = process.env.E2E_CRM_EMAIL;
const PASSWORD = process.env.E2E_CRM_PASSWORD;


/** Wait for the queue to actually finish loading before counting anything.
 *
 *  A fixed pause is not enough and made this spec flaky: the list endpoint
 *  builds a DealState for every live house in the business and takes about
 *  eight seconds on the real board, so a 2 second wait skipped tests as "no
 *  live deals" while the queue was still fetching. Wait for the skeletons to
 *  give way to rows, or for the honest empty state, whichever arrives.
 */
async function settledRows(page: import('@playwright/test').Page) {
  const rows = page.getByTestId('cockpit-row');
  await Promise.race([
    rows.first().waitFor({ state: 'visible', timeout: 45_000 }),
    page.getByText(/Nothing is waiting on anybody/).waitFor({ state: 'visible', timeout: 45_000 }),
  ]).catch(() => {});
  return rows;
}

test.describe('the cockpit', () => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_CRM_EMAIL / _PASSWORD not set');

  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.locator('input[type="email"]').first().fill(EMAIL!);
    await page.locator('input[type="password"]').first().fill(PASSWORD!);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL(/\/dashboard|\/admin|\/leads|\/inbox/, { timeout: 30_000 }).catch(() => {});
  });

  test('opens for a signed-in CRM user and is in the sidebar', async ({ page }) => {
    await page.goto(COCKPIT);
    await expect(page.getByTestId('cockpit-page')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Cockpit' })).toBeVisible();
    await expect(page.locator(`a[href="${COCKPIT}"]`).first()).toBeVisible();
  });

  test('says plainly what somebody is looking at', async ({ page }) => {
    await page.goto(COCKPIT);
    await expect(page.getByTestId('cockpit-page')).toBeVisible({ timeout: 20_000 });
    // Either the brain is on and it says so, or it is off and it says what is
    // showing instead. What it must never do is show an order with no
    // explanation of where the order came from.
    await expect(
      page.getByText(/Ordered by what needs a person most|The deal brain is off/),
    ).toBeVisible();
  });

  test('THE PROMISE: the most urgent deal is at the top', async ({ page }) => {
    await page.goto(COCKPIT);
    await expect(page.getByTestId('cockpit-page')).toBeVisible({ timeout: 20_000 });
    const rows = await settledRows(page);
    const count = await rows.count();
    test.skip(count === 0, 'no live deals on this account today');

    const scores: number[] = [];
    for (let i = 0; i < count; i += 1) {
      scores.push(Number(await rows.nth(i).getAttribute('data-attention')));
    }
    for (let i = 1; i < scores.length; i += 1) {
      expect(scores[i], `row ${i} outranks row ${i - 1}`).toBeLessThanOrEqual(scores[i - 1]);
    }
  });

  test('three columns on a desktop, the history folds into a tab below 1280', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(COCKPIT);
    await expect(page.getByTestId('cockpit-queue')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('cockpit-log')).toBeVisible();

    await page.setViewportSize({ width: 900, height: 900 });
    await expect(page.getByTestId('cockpit-log')).toBeHidden();
    await expect(page.getByTestId('cockpit-view-tabs')).toBeVisible();
  });

  test('picking a deal fills the middle and the history', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(COCKPIT);
    await expect(page.getByTestId('cockpit-page')).toBeVisible({ timeout: 20_000 });
    const rows = await settledRows(page);
    test.skip(await rows.count() === 0, 'no live deals on this account today');

    await rows.first().click();
    await expect(page.getByTestId('cockpit-command-header')).toBeVisible({ timeout: 15_000 });
    // The deal is now in the URL, so the screen is shareable and survives a
    // refresh, which matters when Hugo is telling somebody which one he means.
    await expect(page).toHaveURL(/deal=/);
  });

  test('COMPARISONS IS A PURE REVEAL: it makes no network call', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(COCKPIT);
    await expect(page.getByTestId('cockpit-page')).toBeVisible({ timeout: 20_000 });
    const rows = await settledRows(page);
    test.skip(await rows.count() === 0, 'no live deals on this account today');
    await rows.first().click();
    await expect(page.getByTestId('cockpit-command-header')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1_500);

    // Start counting only now: the listings are already loaded by this point,
    // so expanding them must cost nothing at all.
    let calls = 0;
    page.on('request', (r) => {
      if (/\/api\/|\/functions\/v1\//.test(r.url())) calls += 1;
    });

    await page.getByTestId('cockpit-comparisons-toggle').click();
    await expect(page.getByTestId('cockpit-comparisons')).toBeVisible();
    await page.waitForTimeout(1_000);
    expect(calls, 'expanding the comparisons hit the network').toBe(0);
  });

  test('THE GATE HOLDS: a refusal is readable, and nothing fires', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(COCKPIT);
    await expect(page.getByTestId('cockpit-page')).toBeVisible({ timeout: 20_000 });
    const rows = await settledRows(page);
    test.skip(await rows.count() === 0, 'no live deals on this account today');
    await rows.first().click();
    await expect(page.getByTestId('cockpit-actions')).toBeVisible({ timeout: 15_000 });

    const before = await page.getByTestId('cockpit-log-entry').count();

    // "Hold, nothing today" is the safest button on the page and still opens
    // the gate, which is the point: nothing happens without a second press.
    await page.getByTestId('cockpit-action-hold').click();
    await expect(page.getByTestId('cockpit-confirm')).toBeVisible({ timeout: 10_000 });

    // Region 1: it says what is about to happen, in the present tense.
    await expect(page.getByTestId('cockpit-confirm-sentence')).toBeVisible();

    // If anything blocks, the reason is ENGLISH, not a code, and the button is
    // dead. This is the assertion that matters most on this page.
    const blocked = page.getByTestId('cockpit-confirm-blocked');
    if (await blocked.count() > 0) {
      const reason = (await blocked.innerText()).trim();
      expect(reason.length).toBeGreaterThan(20);
      expect(reason, 'the refusal reads as a code, not a sentence').not.toMatch(/_/);
      await expect(page.getByTestId('cockpit-confirm-commit')).toBeDisabled();
    }

    // Escape, and prove nothing happened.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('cockpit-confirm')).toBeHidden();
    await page.waitForTimeout(1_000);
    expect(await page.getByTestId('cockpit-log-entry').count()).toBe(before);
  });

  test('the history column explains itself before anything has happened', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(COCKPIT);
    await expect(page.getByTestId('cockpit-log')).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByTestId('cockpit-log').getByText(/history of whichever deal you pick|Nothing has happened/),
    ).toBeVisible();
  });
});
