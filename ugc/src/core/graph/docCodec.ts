// GraphDoc <-> React Flow projection. React Flow never owns truth: the store
// mutates the doc through the pure functions and re-projects. Kept free of
// @xyflow imports so the whole core stays renderer-agnostic; the shapes below
// are structurally compatible with React Flow v12 nodes and edges.
//
// Position convention: the doc stores ABSOLUTE positions. React Flow wants
// child positions relative to their parent (band), and parents listed before
// children. The codec does both conversions.

import type { GraphDoc, NodeDoc, SlotId } from './types';

export interface RFNodeLite {
  id: string;
  type: 'band' | 'stage' | 'note';
  position: { x: number; y: number };
  parentId?: string;
  data: Record<string, unknown>;
}

export interface RFEdgeLite {
  id: string;
  source: string;
  target: string;
  sourceHandle: 'out';
  targetHandle: SlotId;
  type: 'bridge';
}

export interface RFProjection {
  nodes: RFNodeLite[];
  edges: RFEdgeLite[];
}

export function toReactFlow(doc: GraphDoc): RFProjection {
  const groupById = new Map(doc.groups.map((g) => [g.id, g]));

  const bands: RFNodeLite[] = doc.groups.map((g) => ({
    id: g.id,
    type: 'band',
    position: g.position,
    data: { label: g.label, tint: g.tint, size: g.size },
  }));

  const stages: RFNodeLite[] = doc.nodes.map((n) => {
    const group = n.groupId ? groupById.get(n.groupId) : undefined;
    const position = group
      ? { x: n.position.x - group.position.x, y: n.position.y - group.position.y }
      : n.position;
    const base: RFNodeLite = {
      id: n.id,
      type: n.kind === 'note' ? 'note' : 'stage',
      position,
      data: { kind: n.kind, label: n.label },
    };
    if (group) base.parentId = group.id;
    return base;
  });

  return {
    // Parents must precede children for React Flow.
    nodes: [...bands, ...stages],
    edges: doc.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: 'out',
      targetHandle: e.targetHandle,
      type: 'bridge',
    })),
  };
}

// Write canvas position changes back into the doc as absolute coordinates.
export function applyPositions(
  doc: GraphDoc,
  moved: Array<{ id: string; position: { x: number; y: number }; parentId?: string }>,
): GraphDoc {
  const groupById = new Map(doc.groups.map((g) => [g.id, g]));
  const byId = new Map(moved.map((m) => [m.id, m]));

  const groups = doc.groups.map((g) => {
    const m = byId.get(g.id);
    return m ? { ...g, position: m.position } : g;
  });

  const nodes: NodeDoc[] = doc.nodes.map((n) => {
    const m = byId.get(n.id);
    if (!m) return n;
    const group = m.parentId ? groupById.get(m.parentId) : n.groupId ? groupById.get(n.groupId) : undefined;
    const absolute = group
      ? { x: m.position.x + group.position.x, y: m.position.y + group.position.y }
      : m.position;
    return { ...n, position: absolute, groupId: group?.id ?? null };
  });

  return { ...doc, groups, nodes };
}
