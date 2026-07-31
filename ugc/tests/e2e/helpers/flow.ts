// Shared e2e helpers. Selectors come from src/testids.ts so a rename cannot
// silently break a spec.

import { expect, type Page } from '@playwright/test';
import { TID } from '../../../src/testids';

export { TID };

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==',
  'base64',
);

const WAV_TINY = Buffer.from(
  'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=',
  'base64',
);

export const FIXTURE_PNG = { name: 'photo.png', mimeType: 'image/png', buffer: PNG_1x1 };
export const FIXTURE_WAV = { name: 'sample.wav', mimeType: 'audio/wav', buffer: WAV_TINY };

// Create a project through the real product form and land on the canvas.
export async function createProject(page: Page, name = 'Glow Serum'): Promise<void> {
  await page.goto('/');
  await page.getByTestId(TID.newProjectButton).click();
  await page.getByTestId(TID.productName).fill(name);
  await page.getByTestId(TID.productCategory).fill('skincare');
  await page.getByTestId(TID.productCreate).click();
  await expect(page.getByTestId(TID.canvas)).toBeVisible();
  await expect(page.getByTestId(TID.node('video'))).toBeVisible();
}

// Upload a photo into an asset node via its panel.
export async function uploadPhoto(page: Page, nodeId: string): Promise<void> {
  await page.getByTestId(TID.node(nodeId)).click();
  await page.getByTestId(TID.panelUpload).setInputFiles(FIXTURE_PNG);
  // The node card flips from the dashed placeholder to a thumbnail.
  await expect(page.getByTestId(TID.node(nodeId)).locator('img')).toBeVisible();
}

// Drag a connection from one node's out handle to another node's in handle.
// Fits the viewport first: a node added after load can sit outside the fitted
// view, and a mouse drag cannot reach an off-screen handle.
export async function dragConnect(page: Page, sourceId: string, targetId: string): Promise<void> {
  await page.locator('.react-flow__controls-fitview').click();
  await page.waitForTimeout(400);
  const from = page.getByTestId(TID.handleOut(sourceId));
  const to = page.getByTestId(TID.handleIn(targetId));
  const fb = (await from.boundingBox())!;
  const tb = (await to.boundingBox())!;
  await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2);
  await page.mouse.down();
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 14 });
  await page.mouse.up();
}

// Fill the voice stage (script + first curated voice) via its panel.
export async function prepareVoice(page: Page, script = 'This serum changed my whole morning routine, honestly.'): Promise<void> {
  await page.getByTestId(TID.node('voice')).click();
  await page.getByTestId(TID.panelField('script')).fill(script);
  await page.getByTestId(TID.voiceCard('v-amelia')).click();
}

export async function expectNodeDone(page: Page, nodeId: string): Promise<void> {
  await expect(page.getByTestId(TID.nodeStatus(nodeId))).toHaveText('Done', { timeout: 15_000 });
}
