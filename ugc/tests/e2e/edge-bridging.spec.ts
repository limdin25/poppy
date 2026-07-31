// THE core mechanic: dragging an edge IS the input assignment. No incoming
// edge means no Input Assignment section at all; connecting materialises it
// bound to the upstream node; deleting the edge removes it entirely.

import { test, expect } from '@playwright/test';
import { createProject, dragConnect, TID } from './helpers/flow';

test('an edge drag assigns the input and the panel follows the topology', async ({ page }) => {
  await createProject(page);

  // A fresh photo node has no incoming edges: NO Input Assignment section.
  await page.getByTestId(TID.paletteAdd('photo')).click();
  const newNode = page.getByTestId(/^node-n-/);
  await expect(newNode).toBeVisible();
  const newNodeId = (await newNode.getAttribute('data-testid'))!.replace('node-', '');
  await expect(page.getByTestId(TID.panel)).toBeVisible();
  await expect(page.getByTestId(TID.panelInputs)).toHaveCount(0);

  // Drag influencer.out -> the new photo node: the edge lands on refImage1
  // and the section materialises, naming the upstream node.
  await dragConnect(page, 'influencer', newNodeId);
  await newNode.click();
  await expect(page.getByTestId(TID.panelInputs)).toBeVisible();
  await expect(page.getByTestId(TID.panelSlotRow('refImage1'))).toContainText('Influencer Photo');

  // Unlink: the binding dies with the edge and the whole section disappears.
  await page.getByTestId(TID.panelUnlink('refImage1')).click();
  await expect(page.getByTestId(TID.panelInputs)).toHaveCount(0);
});

test('connections respect the validity matrix (voice cannot feed a photo)', async ({ page }) => {
  await createProject(page);
  await page.getByTestId(TID.paletteAdd('photo')).click();
  const newNode = page.getByTestId(/^node-n-/);
  const newNodeId = (await newNode.getAttribute('data-testid'))!.replace('node-', '');

  // Attempt voice.out -> photo.in: isValidConnection refuses, no edge forms.
  await dragConnect(page, 'voice', newNodeId);
  await newNode.click();
  await expect(page.getByTestId(TID.panelInputs)).toHaveCount(0);
});
