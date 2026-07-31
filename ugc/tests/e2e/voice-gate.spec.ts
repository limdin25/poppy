// The flagship test: no lip-sync until the audio is explicitly approved, and
// a re-generated voice closes the gate again.

import { test, expect } from '@playwright/test';
import { createProject, uploadPhoto, prepareVoice, expectNodeDone, TID } from './helpers/flow';

test('the video refuses to run until the voice take is approved', async ({ page }) => {
  await createProject(page);
  await uploadPhoto(page, 'influencer');
  await uploadPhoto(page, 'product');
  await prepareVoice(page);

  // Run all: composite and voice run; the video comes out BLOCKED.
  await page.getByTestId(TID.runAll).click();
  await expectNodeDone(page, 'composite');
  await expectNodeDone(page, 'voice');
  await expect(page.getByTestId(TID.nodeStatus('video'))).toHaveText('Awaiting approval');

  // Poking the video's own run button: refusal toast, no run.
  await page.getByTestId(TID.nodeRun('video')).click();
  await expect(page.getByTestId(TID.toast)).toContainText('Approve the voice track');

  // Approve the take: the gate opens and the video runs to Done.
  await page.getByTestId(TID.node('voice')).click();
  await page.getByTestId(TID.panelApprove).click();
  await expect(page.getByTestId(TID.panelApproved)).toBeVisible();
  await page.getByTestId(TID.nodeRun('video')).click();
  await expectNodeDone(page, 'video');

  // Re-generate the voice: a NEW take cannot inherit the old approval.
  await page.getByTestId(TID.node('voice')).click();
  await page.getByTestId(TID.nodeRun('voice')).click();
  await expectNodeDone(page, 'voice');
  await expect(page.getByTestId(TID.panelApprove)).toBeVisible();
  await page.getByTestId(TID.nodeRun('video')).click();
  await expect(page.getByTestId(TID.toast)).toContainText('Approve the voice track');
});
