// The clone path: upload a sample, name it, and the new voice appears at the
// top of the list wearing the "Yours" pill, already selected.

import { test, expect } from '@playwright/test';
import { createProject, FIXTURE_WAV, TID } from './helpers/flow';

test('cloning a voice adds it to the list with the Yours pill', async ({ page }) => {
  await createProject(page);
  await page.getByTestId(TID.node('voice')).click();

  await page.getByTestId(TID.voiceCloneTab).click();
  await page.getByTestId(TID.voiceCloneName).fill('My voice');
  await page.getByTestId(TID.voiceCloneFile).setInputFiles(FIXTURE_WAV);
  await page.getByTestId(TID.voiceCloneStart).click();

  // Back on the list, the clone sits on top, selected, with the pill.
  await expect(page.getByTestId(TID.voiceList)).toBeVisible();
  const first = page.getByTestId(TID.voiceList).locator('button').first();
  await expect(first).toContainText('My voice');
  await expect(first).toContainText('Yours');
});
