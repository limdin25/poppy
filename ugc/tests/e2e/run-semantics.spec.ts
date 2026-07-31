// Metered-product run semantics: a second Run All reuses fresh outputs
// instead of re-billing, editing a prompt flips the node Out of date, and
// partial runs work from the kebab.

import { test, expect } from '@playwright/test';
import { createProject, uploadPhoto, prepareVoice, expectNodeDone, TID } from './helpers/flow';

test('fresh nodes reuse; edits flip stale; run-from-here picks them up', async ({ page }) => {
  await createProject(page);
  await uploadPhoto(page, 'influencer');
  await uploadPhoto(page, 'product');
  await prepareVoice(page);

  await page.getByTestId(TID.runAll).click();
  await expectNodeDone(page, 'composite');
  await expectNodeDone(page, 'voice');

  const balanceAfterFirst = await page.getByTestId(TID.creditsTotal).textContent();

  // Run All again: everything fresh is reused, the balance does not move.
  await page.getByTestId(TID.runAll).click();
  await page.waitForTimeout(1200);
  await expect(page.getByTestId(TID.creditsTotal)).toHaveText(balanceAfterFirst!);

  // Editing the composite prompt makes it stale.
  await page.getByTestId(TID.node('composite')).click();
  await page.getByTestId(TID.panelField('prompt')).fill('a totally different scene');
  await expect(page.getByTestId(TID.nodeStatus('composite'))).toHaveText('Out of date');

  // Run from here re-runs the stale composite (and bills for it).
  await page.getByTestId(TID.runMenu).click();
  await page.getByTestId(TID.runFromHere).click();
  await expectNodeDone(page, 'composite');
  const balanceAfterRerun = await page.getByTestId(TID.creditsTotal).textContent();
  expect(Number(balanceAfterRerun)).toBeLessThan(Number(balanceAfterFirst));
});
