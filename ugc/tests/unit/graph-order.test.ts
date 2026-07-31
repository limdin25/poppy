// Run-plan semantics: topo determinism, all/from/till/group resolution, the
// force flag, reuse vs run, and blocked entries that never silently pull
// nodes from outside a group.

import { describe, it, expect } from 'vitest';
import { topoOrder, resolveRun } from '../../src/core/graph/order';
import { hashInputs } from '../../src/core/graph/gating';
import { applyConnect } from '../../src/core/graph/connect';
import { doc, node, output, asset } from './helpers/build';
import type { GraphDoc } from '../../src/core/graph/types';

function pipeline(): GraphDoc {
  let d = doc({
    nodes: [
      node('influencer', 'asset', { output: output({ assetRef: asset({ assetId: 'a-inf' }) }) }),
      node('product', 'asset', { output: output({ assetRef: asset({ assetId: 'a-prod' }) }) }),
      node('composite', 'photo', { config: { prompt: 'holding it' }, groupId: 'g-gen' }),
      node('vox', 'voice', { config: { script: 'Try this', voiceId: 'v-1' }, groupId: 'g-gen' }),
      node('vid', 'video', { config: {}, groupId: 'g-out' }),
    ],
  });
  d = applyConnect(d, { source: 'influencer', target: 'composite', targetHandle: 'refImage1' });
  d = applyConnect(d, { source: 'product', target: 'composite', targetHandle: 'refImage2' });
  d = applyConnect(d, { source: 'composite', target: 'vid', targetHandle: 'startImage' });
  d = applyConnect(d, { source: 'vox', target: 'vid', targetHandle: 'audio' });
  return d;
}

function withFreshOutput(d: GraphDoc, nodeId: string, assetId: string, extra: Record<string, unknown> = {}): GraphDoc {
  const nodes = d.nodes.map((n) =>
    n.id === nodeId
      ? {
          ...n,
          output: output({
            assetRef: asset({ assetId, ...extra }),
            inputsHash: hashInputs(d, nodeId),
            category: n.kind === 'voice' ? ('audio' as const) : n.kind === 'video' ? ('video' as const) : ('image' as const),
          }),
        }
      : n,
  );
  return { ...d, nodes };
}

function approved(d: GraphDoc, nodeId: string): GraphDoc {
  const nodes = d.nodes.map((n) =>
    n.id === nodeId && n.output
      ? { ...n, approval: { approvedAt: 'now', approvedAssetId: n.output.assetRef.assetId } }
      : n,
  );
  return { ...d, nodes };
}

describe('topoOrder', () => {
  it('is deterministic with ties broken by node id', () => {
    const d = pipeline();
    const r = topoOrder(d);
    // Sorted-queue Kahn: composite unlocks after product and wins the
    // alphabetical tie against vox.
    expect('order' in r && r.order).toEqual(['influencer', 'product', 'composite', 'vox', 'vid']);
  });

  it('reports a cycle instead of throwing', () => {
    const d = pipeline();
    // Force a cycle directly in the data (applyConnect would refuse).
    d.edges.push({ id: 'bad', source: 'vid', sourceHandle: 'out', target: 'composite', targetHandle: 'refImage1' });
    const r = topoOrder(d);
    expect('cycle' in r).toBe(true);
    if ('cycle' in r) expect(r.cycle).toContain('vid');
  });
});

describe('resolveRun: run all', () => {
  it('plans generators in topo order, skips assets and notes', () => {
    const plan = resolveRun(pipeline(), { mode: 'all' });
    expect(plan.entries.map((e) => e.nodeId)).toEqual(['composite', 'vox', 'vid']);
  });

  it('the video is blocked on unapproved audio even when everything upstream runs in-plan', () => {
    const plan = resolveRun(pipeline(), { mode: 'all' });
    const vid = plan.entries.find((e) => e.nodeId === 'vid')!;
    expect(vid.action).toBe('blocked');
    expect(vid.reason).toBe('unapproved-audio');
  });

  it('with approved audio and a fresh voice, the video runs and is billed by real audio duration', () => {
    let d = pipeline();
    d = withFreshOutput(d, 'vox', 'take-1', { durationSec: 12, mime: 'audio/wav' });
    d = approved(d, 'vox');
    const plan = resolveRun(d, { mode: 'all' });
    const vid = plan.entries.find((e) => e.nodeId === 'vid')!;
    expect(vid.action).toBe('run');
    // 12s at 20 credits a second.
    expect(vid.estimatedCredits).toBe(240);
    const vox = plan.entries.find((e) => e.nodeId === 'vox')!;
    expect(vox.action).toBe('reuse');
    expect(plan.totalCredits).toBe(30 + 240);
  });

  it('force re-runs fresh nodes, and re-running the voice re-closes the gate', () => {
    let d = pipeline();
    d = withFreshOutput(d, 'vox', 'take-1');
    d = approved(d, 'vox');
    d = withFreshOutput(d, 'composite', 'comp-1');
    const plan = resolveRun(d, { mode: 'all' }, { force: true });
    const vox = plan.entries.find((e) => e.nodeId === 'vox')!;
    expect(vox.action).toBe('run');
    // A forced voice re-run means a NEW take, which cannot be pre-approved:
    // the video must come out blocked, not silently billed.
    const vid = plan.entries.find((e) => e.nodeId === 'vid')!;
    expect(vid.action).toBe('blocked');
    expect(vid.reason).toBe('unapproved-audio');
  });
});

describe('resolveRun: partial plans', () => {
  it('from = the node and its descendants only', () => {
    const plan = resolveRun(pipeline(), { mode: 'from', nodeId: 'composite' });
    expect(plan.entries.map((e) => e.nodeId)).toEqual(['composite', 'vid']);
  });

  it('till = the ancestors and the node only', () => {
    const plan = resolveRun(pipeline(), { mode: 'till', nodeId: 'composite' });
    expect(plan.entries.map((e) => e.nodeId)).toEqual(['composite']);
  });

  it('group runs only its members and blocks on out-of-group unrun upstreams instead of pulling them in', () => {
    const plan = resolveRun(pipeline(), { mode: 'group', groupId: 'g-out' });
    expect(plan.entries.map((e) => e.nodeId)).toEqual(['vid']);
    expect(plan.entries[0]!.action).toBe('blocked');
  });

  it('single with force is the "Run again" path', () => {
    let d = pipeline();
    d = withFreshOutput(d, 'composite', 'comp-1');
    const noForce = resolveRun(d, { mode: 'single', nodeId: 'composite' });
    expect(noForce.entries[0]!.action).toBe('reuse');
    const forced = resolveRun(d, { mode: 'single', nodeId: 'composite' }, { force: true });
    expect(forced.entries[0]!.action).toBe('run');
    expect(forced.totalCredits).toBe(30);
  });
});
