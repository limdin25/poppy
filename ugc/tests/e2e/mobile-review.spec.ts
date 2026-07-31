// Mobile review mode: on a phone the canvas is viewable and the voice take
// can be APPROVED (the genuinely useful mobile workflow); editing chrome
// (Run all, palette) stays hidden.

import { test, expect } from '@playwright/test';
import { createProject, TID } from './helpers/flow';

test('a phone can review and approve but not edit', async ({ page }) => {
  await createProject(page);

  // Editing chrome is hidden below md.
  await expect(page.getByTestId(TID.runAll)).toBeHidden();
  await expect(page.getByTestId(TID.paletteAdd('photo'))).toBeHidden();

  // Tapping a node still opens its panel (review + approve path).
  await page.getByTestId(TID.node('voice')).click();
  await expect(page.getByTestId(TID.panel)).toBeVisible();
});
