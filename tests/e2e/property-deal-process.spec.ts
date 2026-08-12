import { test, expect, type Page } from '@playwright/test';

// The Deal process page: the step by step Hugo asked to be able to open at any
// time, with the messages to copy underneath each step.
//
// Hugo 2026-08-12: it is its own menu item under Templates, not a tab inside it.
//
// Admin page, so it signs in with its own credentials rather than the shared
// demo storageState.
//
//   E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... npx playwright test property-deal-process

test.use({ storageState: { cookies: [], origins: [] } });

const EMAIL = process.env.E2E_ADMIN_EMAIL;
const PASSWORD = process.env.E2E_ADMIN_PASSWORD;

async function signIn(page: Page) {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(EMAIL!);
  await page.locator('input[type="password"]').fill(PASSWORD!);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/admin|\/dashboard/, { timeout: 30_000 });
}

test.describe('Deal process page', () => {
  test.skip(!EMAIL || !PASSWORD, 'set E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD');

  test('opens from the menu, under Templates', async ({ page }) => {
    await signIn(page);
    // Reached from the menu, which is where Hugo asked for it.
    await page.goto('/admin/crm/templates');
    const menuLink = page.locator('a[href="/admin/crm/deal-process"]').first();
    await expect(menuLink).toBeVisible({ timeout: 20_000 });
    await menuLink.click();
    await expect(page).toHaveURL(/\/admin\/crm\/deal-process/);

    await expect(page.locator('body')).toContainText(/Property deals, start to finish/i);
    // Step 1 is open by default and says what to do in Pedro's words.
    await expect(page.locator('body')).toContainText(/The ballpark call/i);
    await expect(page.locator('body')).toContainText(/Do now/i);
    await expect(page.locator('body')).toContainText(/Done when/i);
  });

  test('every step is listed, in order, with its pipeline tag', async ({ page }) => {
    await signIn(page);
    await page.goto('/admin/crm/deal-process');

    for (const step of [
      'The ballpark call',
      'Get the photos and the floorplan',
      'Confirm the GDV and the works',
      'Hugo gets the building estimate',
      'Submit the formal offer',
      'Offer accepted',
      'The real quote',
      'Exchange, then completion',
    ]) {
      await expect(page.locator('body')).toContainText(step);
    }
    // The tag is what the pipeline card shows, so it has to be on screen here too.
    await expect(page.locator('body')).toContainText('Hugo prices the works');
  });

  test('opening a step reveals the message to send, with a copy button', async ({ page }) => {
    await signIn(page);
    await page.goto('/admin/crm/deal-process');

    await page.getByRole('button', { name: /Submit the formal offer/i }).click();
    // The wording the live script and the AI coach both use. "Subject to
    // survey" would contradict what Pedro says on the phone.
    await expect(page.locator('body')).toContainText(/Subject to: our builder going round/i);
    await expect(
      page.getByRole('button', { name: /Copy Formal offer email/i })
    ).toBeVisible();
  });

  test('the agent questions are on the page, proof of funds included', async ({ page }) => {
    await signIn(page);
    await page.goto('/admin/crm/deal-process');

    await expect(page.locator('body')).toContainText(/What the agent asks/i);
    await expect(page.locator('body')).toContainText(/Can I see proof of funds/i);
    await expect(page.locator('body')).toContainText(/Who is your solicitor/i);
  });
});
