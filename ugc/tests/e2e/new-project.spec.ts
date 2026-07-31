// Creating a project drops the user onto the pre-built blessed flow: three
// bands, five nodes, four pre-wired edges.

import { test, expect } from '@playwright/test';
import { createProject, TID } from './helpers/flow';

test('a new project opens the scaffold with bands and pre-wired nodes', async ({ page }) => {
  await createProject(page);

  for (const band of ['g-input', 'g-generation', 'g-output']) {
    await expect(page.getByTestId(TID.band(band))).toBeVisible();
  }
  for (const node of ['influencer', 'product', 'composite', 'voice', 'video']) {
    await expect(page.getByTestId(TID.node(node))).toBeVisible();
  }

  // The video node is pre-wired, so its panel opens WITH an Input Assignment
  // section showing the start image and voice track already bound.
  await page.getByTestId(TID.node('video')).click();
  await expect(page.getByTestId(TID.panelInputs)).toBeVisible();
  await expect(page.getByTestId(TID.panelSlotRow('startImage'))).toContainText('Scene Photo');
  await expect(page.getByTestId(TID.panelSlotRow('audio'))).toContainText('Voice');
});

test('the product form supports dynamic selling points', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId(TID.newProjectButton).click();
  await page.getByTestId(TID.productAddPoint).click();
  await expect(page.getByTestId(TID.productSellingPoint)).toHaveCount(2);
});
