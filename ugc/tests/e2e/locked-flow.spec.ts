// The full happy path: photos in, voice approved, direction set, video out.

import { test, expect } from '@playwright/test';
import { createProject, uploadPhoto, prepareVoice, expectNodeDone, TID } from './helpers/flow';

test('photos -> voice -> approve -> direction -> finished video', async ({ page }) => {
  await createProject(page);
  await uploadPhoto(page, 'influencer');
  await uploadPhoto(page, 'product');
  await prepareVoice(page);

  await page.getByTestId(TID.runAll).click();
  await expectNodeDone(page, 'composite');
  await expectNodeDone(page, 'voice');

  await page.getByTestId(TID.node('voice')).click();
  await page.getByTestId(TID.panelApprove).click();
  await expect(page.getByTestId(TID.panelApproved)).toBeVisible();

  await page.getByTestId(TID.node('video')).click();
  await page
    .getByTestId(TID.panelField('direction'))
    .fill('Hold the product at chest height, point at the label, smile on the last line');

  await page.getByTestId(TID.nodeRun('video')).click();
  await expectNodeDone(page, 'video');

  // The result renders in the output section with its credit cost.
  await page.getByTestId(TID.node('video')).click();
  await expect(page.getByTestId(TID.panelOutput)).toBeVisible();
  await expect(page.getByTestId(TID.panelOutput)).toContainText('credits');
});
