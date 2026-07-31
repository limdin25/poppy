// The blessed flow: pre-built bands, pre-wired edges, and a first-run plan
// that blocks for exactly the right reasons (nothing uploaded, no script,
// no approved voice). Positions and ids are pinned so autosave diffs stay
// stable across sessions.

import { describe, it, expect } from 'vitest';
import { buildDefaultFlow } from '../../src/core/graph/scaffold';
import { validateDoc } from '../../src/core/graph/validate';
import { resolveRun } from '../../src/core/graph/order';
import { derivePanel } from '../../src/core/graph/panel';

const NOW = '2026-07-31T12:00:00Z';

describe('buildDefaultFlow', () => {
  const flow = buildDefaultFlow('p-1', NOW);

  it('lays out the three bands and five nodes', () => {
    expect(flow.groups.map((g) => [g.id, g.tint])).toEqual([
      ['g-input', 'input'],
      ['g-generation', 'generation'],
      ['g-output', 'output'],
    ]);
    expect(flow.nodes.map((n) => [n.id, n.kind, n.groupId])).toEqual([
      ['influencer', 'asset', 'g-input'],
      ['product', 'asset', 'g-input'],
      ['composite', 'photo', 'g-generation'],
      ['voice', 'voice', 'g-generation'],
      ['video', 'video', 'g-output'],
    ]);
  });

  it('pre-wires the four blessed edges to the right slots', () => {
    expect(flow.edges.map((e) => [e.source, e.targetHandle, e.target])).toEqual([
      ['influencer', 'refImage1', 'composite'],
      ['product', 'refImage2', 'composite'],
      ['composite', 'startImage', 'video'],
      ['voice', 'audio', 'video'],
    ]);
  });

  it('passes validation with zero repairs', () => {
    const { repairs } = validateDoc(flow);
    expect(repairs).toEqual([]);
  });

  it('a fresh scaffold blocks each stage for exactly the right reason', () => {
    const plan = resolveRun(flow, { mode: 'all' });
    const byId = Object.fromEntries(plan.entries.map((e) => [e.nodeId, e]));
    // Nothing uploaded yet: the composite waits on its references.
    expect(byId['composite']!.action).toBe('blocked');
    expect(byId['composite']!.reason).toBe('upstream-unrun');
    // No script yet.
    expect(byId['voice']!.action).toBe('blocked');
    expect(byId['voice']!.reason).toBe('invalid-config');
    // The video waits on its start image before anything else.
    expect(byId['video']!.action).toBe('blocked');
    expect(plan.totalCredits).toBe(0);
  });

  it('the video node opens with a visible Input Assignment (it is pre-wired)', () => {
    const inputs = derivePanel(flow, 'video').find((s) => s.type === 'inputs');
    expect(inputs?.type).toBe('inputs');
    if (inputs?.type === 'inputs') {
      const bound = inputs.rows.filter((r) => r.bound !== null).map((r) => r.slot);
      expect(bound).toEqual(['startImage', 'audio']);
    }
  });

  it('the scaffold is deterministic', () => {
    expect(buildDefaultFlow('p-1', NOW)).toEqual(buildDefaultFlow('p-1', NOW));
  });
});
