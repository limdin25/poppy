// The blessed UGC flow as data. Every new project opens with this graph
// pre-built and pre-wired, so the foundation (influencer photo + product
// photo) is literally the first two cards the user sees. The canvas stays
// fully freeform afterwards; correctness comes from the gating engine, not
// from locking the shape. "Reset to standard flow" rebuilds this.

import type { GraphDoc } from './types';

// now is a parameter (not Date.now) so the scaffold stays pure and testable.
export function buildDefaultFlow(projectId: string, now: string): GraphDoc {
  return {
    version: 1,
    projectId,
    updatedAt: now,
    product: null,
    settings: { snapToGrid: true, verticalHandles: false },
    groups: [
      { id: 'g-input', label: 'Input', tint: 'input', position: { x: 0, y: 0 }, size: { width: 340, height: 560 } },
      { id: 'g-generation', label: 'Generation', tint: 'generation', position: { x: 380, y: 0 }, size: { width: 340, height: 560 } },
      { id: 'g-output', label: 'Output', tint: 'output', position: { x: 760, y: 0 }, size: { width: 340, height: 560 } },
    ],
    nodes: [
      {
        id: 'influencer',
        kind: 'asset',
        label: 'Influencer Photo',
        position: { x: 40, y: 60 },
        groupId: 'g-input',
        config: {},
        output: null,
        approval: null,
      },
      {
        id: 'product',
        kind: 'asset',
        label: 'Product Photo',
        position: { x: 40, y: 320 },
        groupId: 'g-input',
        config: {},
        output: null,
        approval: null,
      },
      {
        id: 'composite',
        kind: 'photo',
        label: 'Scene Photo',
        position: { x: 420, y: 60 },
        groupId: 'g-generation',
        config: {
          prompt:
            'A casual phone photo of the person from reference 1 holding the product from reference 2, natural light, looking at the camera',
          aspect: '9:16',
        },
        output: null,
        approval: null,
      },
      {
        id: 'voice',
        kind: 'voice',
        label: 'Voice',
        position: { x: 420, y: 320 },
        groupId: 'g-generation',
        config: { script: '', voiceId: '' },
        output: null,
        approval: { approvedAt: null, approvedAssetId: null },
      },
      {
        id: 'video',
        kind: 'video',
        label: 'Video',
        position: { x: 800, y: 180 },
        groupId: 'g-output',
        config: { direction: '', aspect: '9:16' },
        output: null,
        approval: null,
      },
    ],
    edges: [
      { id: 'e-influencer:refImage1:composite', source: 'influencer', sourceHandle: 'out', target: 'composite', targetHandle: 'refImage1' },
      { id: 'e-product:refImage2:composite', source: 'product', sourceHandle: 'out', target: 'composite', targetHandle: 'refImage2' },
      { id: 'e-composite:startImage:video', source: 'composite', sourceHandle: 'out', target: 'video', targetHandle: 'startImage' },
      { id: 'e-voice:audio:video', source: 'voice', sourceHandle: 'out', target: 'video', targetHandle: 'audio' },
    ],
  };
}
