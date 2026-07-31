// Chrome behaviours: palette buttons and single-key shortcuts add nodes, and
// the credits meter drops after a paid run.

import { test, expect } from '@playwright/test';
import { createProject, uploadPhoto, expectNodeDone, TID } from './helpers/flow';

test('palette clicks and keyboard shortcuts add nodes', async ({ page }) => {
  await createProject(page);
  await page.getByTestId(TID.paletteAdd('photo')).click();
  await expect(page.getByTestId(/^node-n-/)).toHaveCount(1);

  // Single-key shortcut: V adds a video node (focus is on the canvas).
  await page.getByTestId(TID.canvas).click({ position: { x: 40, y: 40 } });
  await page.keyboard.press('v');
  await expect(page.getByTestId(/^node-n-/)).toHaveCount(2);
});

test('the credits meter drops when a generation bills', async ({ page }) => {
  await createProject(page);
  const before = Number(await page.getByTestId(TID.creditsTotal).textContent());
  await uploadPhoto(page, 'influencer');
  await uploadPhoto(page, 'product');
  await page.getByTestId(TID.node('composite')).click();
  await page.getByTestId(TID.nodeRun('composite')).click();
  await expectNodeDone(page, 'composite');
  await expect
    .poll(async () => Number(await page.getByTestId(TID.creditsTotal).textContent()))
    .toBeLessThan(before);
});
