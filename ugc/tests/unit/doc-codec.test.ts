// Doc <-> React Flow projection: bands precede children, child positions go
// relative and come back absolute, and validateDoc repairs corrupt saves
// without bricking anything.

import { describe, it, expect } from 'vitest';
import { toReactFlow, applyPositions } from '../../src/core/graph/docCodec';
import { validateDoc } from '../../src/core/graph/validate';
import { buildDefaultFlow } from '../../src/core/graph/scaffold';
import { doc, node, edge } from './helpers/build';

const NOW = '2026-07-31T12:00:00Z';

describe('toReactFlow', () => {
  const flow = buildDefaultFlow('p-1', NOW);
  const rf = toReactFlow(flow);

  it('lists every band before any stage node', () => {
    const lastBand = rf.nodes.map((n) => n.type).lastIndexOf('band');
    const firstStage = rf.nodes.findIndex((n) => n.type !== 'band');
    expect(lastBand).toBeLessThan(firstStage);
  });

  it('grouped nodes carry parentId and RELATIVE positions', () => {
    const influencer = rf.nodes.find((n) => n.id === 'influencer')!;
    expect(influencer.parentId).toBe('g-input');
    // Doc position 40,60 inside a band at 0,0 stays 40,60; composite at
    // 420,60 inside a band at 380,0 becomes 40,60.
    const composite = rf.nodes.find((n) => n.id === 'composite')!;
    expect(composite.position).toEqual({ x: 40, y: 60 });
  });

  it('edges carry the slot in targetHandle (the binding IS the edge)', () => {
    const audio = rf.edges.find((e) => e.target === 'video' && e.targetHandle === 'audio');
    expect(audio?.source).toBe('voice');
  });
});

describe('applyPositions round trip', () => {
  it('doc -> RF -> doc preserves absolute positions', () => {
    const flow = buildDefaultFlow('p-1', NOW);
    const rf = toReactFlow(flow);
    const moved = rf.nodes
      .filter((n) => n.type !== 'band')
      .map((n) => {
        const m: { id: string; position: { x: number; y: number }; parentId?: string } = {
          id: n.id,
          position: n.position,
        };
        if (n.parentId) m.parentId = n.parentId;
        return m;
      });
    const back = applyPositions(flow, moved);
    expect(back.nodes.map((n) => [n.id, n.position])).toEqual(flow.nodes.map((n) => [n.id, n.position]));
  });

  it('dragging a node writes the new absolute position into the doc', () => {
    const flow = buildDefaultFlow('p-1', NOW);
    const back = applyPositions(flow, [{ id: 'composite', position: { x: 100, y: 90 }, parentId: 'g-generation' }]);
    const composite = back.nodes.find((n) => n.id === 'composite')!;
    // Band g-generation sits at 380,0.
    expect(composite.position).toEqual({ x: 480, y: 90 });
  });
});

describe('validateDoc repairs', () => {
  it('drops edges to missing nodes and reports it', () => {
    const d = doc({
      nodes: [node('img', 'photo')],
      edges: [edge('img', 'ghost', 'startImage')],
    });
    const { doc: repaired, repairs } = validateDoc(d);
    expect(repaired.edges).toEqual([]);
    expect(repairs).toHaveLength(1);
  });

  it('drops type-mismatched and unknown-slot edges', () => {
    const d = doc({
      nodes: [node('vox', 'voice'), node('img', 'photo'), node('vid', 'video')],
      edges: [
        edge('vox', 'img', 'refImage1'),
        edge('img', 'vid', 'audio'),
        edge('img', 'vox', 'startImage'),
      ],
    });
    const { doc: repaired, repairs } = validateDoc(d);
    expect(repaired.edges).toEqual([]);
    expect(repairs).toHaveLength(3);
  });

  it('breaks a saved cycle by dropping the newest offending edge', () => {
    const d = doc({
      nodes: [node('a', 'photo'), node('b', 'photo')],
      edges: [edge('a', 'b', 'refImage1'), edge('b', 'a', 'refImage1')],
    });
    const { doc: repaired, repairs } = validateDoc(d);
    expect(repaired.edges.map((e) => e.source)).toEqual(['a']);
    expect(repairs.some((r) => r.includes('loop'))).toBe(true);
  });

  it('clears a groupId whose group no longer exists', () => {
    const d = doc({ nodes: [node('img', 'photo', { groupId: 'gone' })] });
    const { doc: repaired, repairs } = validateDoc(d);
    expect(repaired.nodes[0]!.groupId).toBeNull();
    expect(repairs).toHaveLength(1);
  });

  it('throws on an unsupported version instead of guessing', () => {
    const d = { ...doc(), version: 2 as unknown as 1 };
    expect(() => validateDoc(d)).toThrow();
  });
});
