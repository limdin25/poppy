// The dynamic panel: no incoming edge means NO Input Assignment section at
// all (the hard requirement), bound rows carry the upstream's label, the
// refImages family windows to bound rows plus one empty, and the approval
// card exists only once there is a take to approve.

import { describe, it, expect } from 'vitest';
import { derivePanel } from '../../src/core/graph/panel';
import { applyConnect, removeEdge } from '../../src/core/graph/connect';
import { hashInputs } from '../../src/core/graph/gating';
import { doc, node, output, asset } from './helpers/build';
import type { GraphDoc } from '../../src/core/graph/types';

function base(): GraphDoc {
  return doc({
    nodes: [
      node('img1', 'asset', { label: 'Influencer Photo', output: output() }),
      node('img2', 'asset', { label: 'Product Photo', output: output() }),
      node('vox', 'voice', { label: 'Voice', config: { script: 'hello', voiceId: 'v-1' } }),
      node('vid', 'video', { label: 'Video' }),
    ],
  });
}

function sectionTypes(d: GraphDoc, id: string): string[] {
  return derivePanel(d, id).map((s) => s.type);
}

describe('the inputs section exists iff the node has an incoming edge', () => {
  it('an unfed video node has NO inputs section', () => {
    expect(sectionTypes(base(), 'vid')).not.toContain('inputs');
  });

  it('connecting one edge materialises the section', () => {
    const d = applyConnect(base(), { source: 'img1', target: 'vid' });
    expect(sectionTypes(d, 'vid')).toContain('inputs');
  });

  it('deleting the last edge removes the section entirely', () => {
    let d = applyConnect(base(), { source: 'img1', target: 'vid' });
    d = removeEdge(d, d.edges[0]!.id);
    expect(sectionTypes(d, 'vid')).not.toContain('inputs');
  });
});

describe('slot rows', () => {
  it('a bound slot names its upstream node', () => {
    const d = applyConnect(base(), { source: 'img1', target: 'vid' });
    const inputs = derivePanel(d, 'vid').find((s) => s.type === 'inputs');
    expect(inputs && inputs.type === 'inputs').toBe(true);
    if (inputs?.type === 'inputs') {
      const start = inputs.rows.find((r) => r.slot === 'startImage')!;
      expect(start.bound?.sourceLabel).toBe('Influencer Photo');
    }
  });

  it('the refImages family shows bound rows plus exactly one empty row', () => {
    let d = base();
    d = applyConnect(d, { source: 'img1', target: 'vid', targetHandle: 'refImage1' });
    d = applyConnect(d, { source: 'img2', target: 'vid', targetHandle: 'refImage2' });
    const inputs = derivePanel(d, 'vid').find((s) => s.type === 'inputs');
    if (inputs?.type === 'inputs') {
      const refRows = inputs.rows.filter((r) => r.slot.startsWith('refImage'));
      expect(refRows.map((r) => [r.slot, r.bound !== null])).toEqual([
        ['refImage1', true],
        ['refImage2', true],
        ['refImage3', false],
      ]);
    } else {
      throw new Error('inputs section missing');
    }
  });
});

describe('approval and output sections', () => {
  it('a voice with no output has no approval card', () => {
    expect(sectionTypes(base(), 'vox')).not.toContain('approval');
  });

  it('a generated take shows an unapproved card, approval flips it, a new take flips it back', () => {
    let d = base();
    const giveTake = (dd: GraphDoc, assetId: string): GraphDoc => ({
      ...dd,
      nodes: dd.nodes.map((n) =>
        n.id === 'vox'
          ? {
              ...n,
              output: output({
                assetRef: asset({ assetId, mime: 'audio/wav' }),
                category: 'audio',
                inputsHash: hashInputs(dd, 'vox'),
              }),
            }
          : n,
      ),
    });
    d = giveTake(d, 'take-1');
    let approval = derivePanel(d, 'vox').find((s) => s.type === 'approval');
    expect(approval?.type === 'approval' && approval.state).toBe('unapproved');

    d = {
      ...d,
      nodes: d.nodes.map((n) =>
        n.id === 'vox' ? { ...n, approval: { approvedAt: 'now', approvedAssetId: 'take-1' } } : n,
      ),
    };
    approval = derivePanel(d, 'vox').find((s) => s.type === 'approval');
    expect(approval?.type === 'approval' && approval.state).toBe('approved');

    d = giveTake(d, 'take-2');
    approval = derivePanel(d, 'vox').find((s) => s.type === 'approval');
    expect(approval?.type === 'approval' && approval.state).toBe('unapproved');
  });

  it('the output section carries the stale flag', () => {
    let d = base();
    d = {
      ...d,
      nodes: d.nodes.map((n) =>
        n.id === 'vox'
          ? { ...n, output: output({ category: 'audio', inputsHash: hashInputs(d, 'vox') }) }
          : n,
      ),
    };
    let out = derivePanel(d, 'vox').find((s) => s.type === 'output');
    expect(out?.type === 'output' && out.stale).toBe(false);
    d = {
      ...d,
      nodes: d.nodes.map((n) => (n.id === 'vox' ? { ...n, config: { ...n.config, script: 'changed' } } : n)),
    };
    out = derivePanel(d, 'vox').find((s) => s.type === 'output');
    expect(out?.type === 'output' && out.stale).toBe(true);
  });
});
