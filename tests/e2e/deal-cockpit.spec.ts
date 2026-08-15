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

import { test, expect } from './helpers/auth';

const COCKPIT = '/admin/crm/cockpit';

test.describe('the cockpit', () => {
  test('opens for a signed-in CRM user and is in the sidebar', async ({ authedPage: page }) => {
    await page.goto(COCKPIT);
    await expect(page.getByTestId('cockpit-page')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Cockpit' })).toBeVisible();
    await expect(page.locator(`a[href="${COCKPIT}"]`).first()).toBeVisible();
  });

  test('says plainly what somebody is looking at', async ({ authedPage: page }) => {
    await page.goto(COCKPIT);
    await expect(page.getByTestId('cockpit-page')).toBeVisible({ timeout: 20_000 });
    // Either the brain is on and it says so, or it is off and it says what is
    // showing instead. What it must never do is show an order with no
    // explanation of where the order came from.
    await expect(
      page.getByText(/Ordered by what needs a person most|The deal brain is off/),
    ).toBeVisible();
  });

  test('THE PROMISE: the most urgent deal is at the top', async ({ authedPage: page }) => {
    await page.goto(COCKPIT);
    await expect(page.getByTestId('cockpit-page')).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(2_000);

    const rows = page.getByTestId('cockpit-row');
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

  test('three columns on a desktop, the history folds into a tab below 1280', async ({ authedPage: page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(COCKPIT);
    await expect(page.getByTestId('cockpit-queue')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('cockpit-log')).toBeVisible();

    await page.setViewportSize({ width: 900, height: 900 });
    await expect(page.getByTestId('cockpit-log')).toBeHidden();
    await expect(page.getByTestId('cockpit-view-tabs')).toBeVisible();
  });

  test('picking a deal fills the middle and the history', async ({ authedPage: page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(COCKPIT);
    await expect(page.getByTestId('cockpit-page')).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(2_000);

    const rows = page.getByTestId('cockpit-row');
    test.skip(await rows.count() === 0, 'no live deals on this account today');

    await rows.first().click();
    await expect(page.getByTestId('cockpit-command-header')).toBeVisible({ timeout: 15_000 });
    // The deal is now in the URL, so the screen is shareable and survives a
    // refresh, which matters when Hugo is telling somebody which one he means.
    await expect(page).toHaveURL(/deal=/);
  });

  test('COMPARISONS IS A PURE REVEAL: it makes no network call', async ({ authedPage: page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(COCKPIT);
    await expect(page.getByTestId('cockpit-page')).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(2_000);

    const rows = page.getByTestId('cockpit-row');
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

  test('THE GATE HOLDS: a refusal is readable, and nothing fires', async ({ authedPage: page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(COCKPIT);
    await expect(page.getByTestId('cockpit-page')).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(2_000);

    const rows = page.getByTestId('cockpit-row');
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

  test('the history column explains itself before anything has happened', async ({ authedPage: page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(COCKPIT);
    await expect(page.getByTestId('cockpit-log')).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByTestId('cockpit-log').getByText(/history of whichever deal you pick|Nothing has happened/),
    ).toBeVisible();
  });
});
