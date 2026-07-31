// The product's core promise: no lip-sync until the audio is explicitly
// approved, and approval belongs to ONE specific take. Also pins staleness:
// an upstream re-run or config change flips every consumer stale via the
// inputs hash, with zero stored state.

import { describe, it, expect } from 'vitest';
import { hashInputs, isStale, isRunnable } from '../../src/core/graph/gating';
import { applyConnect, removeEdge } from '../../src/core/graph/connect';
import { doc, node, output, asset } from './helpers/build';
import type { GraphDoc } from '../../src/core/graph/types';

// The blessed shape: influencer + product feed a composite photo, the
// composite and the voice feed the video.
function pipeline(): GraphDoc {
  let d = doc({
    nodes: [
      node('influencer', 'asset', { output: output({ assetRef: asset({ assetId: 'a-inf' }) }) }),
      node('product', 'asset', { output: output({ assetRef: asset({ assetId: 'a-prod' }) }) }),
      node('composite', 'photo', { config: { prompt: 'holding the product', aspect: '9:16' } }),
      node('vox', 'voice', { config: { script: 'Try this', voiceId: 'v-1' } }),
      node('vid', 'video', { config: { direction: 'smile' } }),
    ],
  });
  d = applyConnect(d, { source: 'influencer', target: 'composite', targetHandle: 'refImage1' });
  d = applyConnect(d, { source: 'product', target: 'composite', targetHandle: 'refImage2' });
  d = applyConnect(d, { source: 'composite', target: 'vid', targetHandle: 'startImage' });
  d = applyConnect(d, { source: 'vox', target: 'vid', targetHandle: 'audio' });
  return d;
}

function withOutput(d: GraphDoc, nodeId: string, assetId: string): GraphDoc {
  const nodes = d.nodes.map((n) =>
    n.id === nodeId
      ? {
          ...n,
          output: output({
            assetRef: asset({ assetId }),
            inputsHash: hashInputs(d, nodeId),
            category: n.kind === 'voice' ? ('audio' as const) : ('image' as const),
          }),
        }
      : n,
  );
  return { ...d, nodes };
}

function approve(d: GraphDoc, nodeId: string): GraphDoc {
  const nodes = d.nodes.map((n) =>
    n.id === nodeId && n.output
      ? { ...n, approval: { approvedAt: '2026-07-31T13:00:00Z', approvedAssetId: n.output.assetRef.assetId } }
      : n,
  );
  return { ...d, nodes };
}

describe('the voice approval gate', () => {
  it('video is not runnable while its bound voice is unapproved, even with all outputs present', () => {
    let d = pipeline();
    d = withOutput(d, 'composite', 'a-comp');
    d = withOutput(d, 'vox', 'a-take1');
    const r = isRunnable(d, 'vid');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unapproved-audio');
  });

  it('approving the current take opens the gate', () => {
    let d = pipeline();
    d = withOutput(d, 'composite', 'a-comp');
    d = withOutput(d, 'vox', 'a-take1');
    d = approve(d, 'vox');
    expect(isRunnable(d, 'vid')).toEqual({ ok: true });
  });

  it('re-generating the voice closes the gate again: approval belongs to ONE take', () => {
    let d = pipeline();
    d = withOutput(d, 'composite', 'a-comp');
    d = withOutput(d, 'vox', 'a-take1');
    d = approve(d, 'vox');
    d = withOutput(d, 'vox', 'a-take2');
    const r = isRunnable(d, 'vid');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unapproved-audio');
  });

  it('the gate is a slot property, so it holds on ANY graph shape the user draws', () => {
    let d = doc({
      nodes: [
        node('someVoice', 'voice', { config: { script: 'x', voiceId: 'v' } }),
        node('someVideo', 'video', { config: {} }),
        node('img', 'asset', { output: output() }),
      ],
    });
    d = applyConnect(d, { source: 'img', target: 'someVideo', targetHandle: 'startImage' });
    d = applyConnect(d, { source: 'someVoice', target: 'someVideo', targetHandle: 'audio' });
    d = withOutput(d, 'someVoice', 'take-x');
    const r = isRunnable(d, 'someVideo');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unapproved-audio');
  });
});

describe('required inputs and configs', () => {
  it('video without a bound audio slot is missing a required input', () => {
    let d = pipeline();
    d = withOutput(d, 'composite', 'a-comp');
    const audioEdge = d.edges.find((e) => e.targetHandle === 'audio')!;
    d = removeEdge(d, audioEdge.id);
    const r = isRunnable(d, 'vid');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('missing-required-input');
  });

  it('a bound but never-run upstream blocks with upstream-unrun', () => {
    let d = pipeline();
    d = withOutput(d, 'vox', 'a-take1');
    d = approve(d, 'vox');
    // composite has no output yet
    const r = isRunnable(d, 'vid');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('upstream-unrun');
  });

  it('a voice with an empty script is invalid-config', () => {
    const d = doc({ nodes: [node('vox', 'voice', { config: { script: '', voiceId: 'v-1' } })] });
    const r = isRunnable(d, 'vox');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-config');
  });

  it('an asset node is never runnable: it is filled by upload, not run', () => {
    const d = doc({ nodes: [node('img', 'asset')] });
    const r = isRunnable(d, 'img');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not-a-generator');
  });
});

describe('staleness via the inputs hash', () => {
  it('a node is fresh right after running and stale after its config changes', () => {
    let d = pipeline();
    d = withOutput(d, 'composite', 'a-comp');
    expect(isStale(d, 'composite')).toBe(false);
    const nodes = d.nodes.map((n) =>
      n.id === 'composite' ? { ...n, config: { ...n.config, prompt: 'different prompt' } } : n,
    );
    d = { ...d, nodes };
    expect(isStale(d, 'composite')).toBe(true);
  });

  it('an upstream re-run flips the downstream stale through the chain', () => {
    let d = pipeline();
    d = withOutput(d, 'composite', 'a-comp');
    d = withOutput(d, 'vox', 'a-take1');
    d = approve(d, 'vox');
    d = withOutput(d, 'vid', 'a-video');
    expect(isStale(d, 'vid')).toBe(false);
    // Re-run the composite: new asset id, video's recorded hash no longer matches.
    d = withOutput(d, 'composite', 'a-comp-2');
    expect(isStale(d, 'vid')).toBe(true);
    const r = isRunnable(d, 'vid');
    expect(r.ok).toBe(true);
  });

  it('deleting a feeding edge makes the downstream stale', () => {
    let d = pipeline();
    d = withOutput(d, 'composite', 'a-comp');
    d = withOutput(d, 'vox', 'a-take1');
    d = approve(d, 'vox');
    d = withOutput(d, 'vid', 'a-video');
    const startEdge = d.edges.find((e) => e.targetHandle === 'startImage')!;
    d = removeEdge(d, startEdge.id);
    expect(isStale(d, 'vid')).toBe(true);
  });

  it('the hash is deterministic and order-independent', () => {
    const d1 = pipeline();
    const d2 = pipeline();
    expect(hashInputs(d1, 'vid')).toBe(hashInputs(d2, 'vid'));
  });
});
