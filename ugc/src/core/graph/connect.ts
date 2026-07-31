// Edge validity and slot assignment. The edge IS the binding (its
// targetHandle names the slot), so everything here is pure functions over the
// doc: the canvas calls canConnect live during a drag (isValidConnection), the
// store calls applyConnect on drop, and validateDoc re-checks saved docs.

import { capability } from './capabilities';
import type { EdgeDoc, GraphDoc, SlotId } from './types';
import { nodeById } from './types';

export type ConnectRejection =
  | 'unknown-node'
  | 'self'
  | 'no-output'
  | 'type-mismatch'
  | 'no-free-slot'
  | 'duplicate'
  | 'cycle';

export interface ConnectCandidate {
  source: string;
  target: string;
  targetHandle?: SlotId;
}

export type ConnectResult = { ok: true; slot: SlotId } | { ok: false; reason: ConnectRejection };

export function wouldCreateCycle(doc: GraphDoc, source: string, target: string): boolean {
  // Adding source -> target creates a cycle iff source is reachable FROM target.
  const seen = new Set<string>();
  const stack = [target];
  while (stack.length) {
    const current = stack.pop()!;
    if (current === source) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const e of doc.edges) {
      if (e.source === current) stack.push(e.target);
    }
  }
  return false;
}

export function canConnect(doc: GraphDoc, candidate: ConnectCandidate): ConnectResult {
  const { source, target, targetHandle } = candidate;
  if (source === target) return { ok: false, reason: 'self' };

  const sourceNode = nodeById(doc, source);
  const targetNode = nodeById(doc, target);
  if (!sourceNode || !targetNode) return { ok: false, reason: 'unknown-node' };

  const outputType = capability(sourceNode.kind).outputType;
  if (outputType === null) return { ok: false, reason: 'no-output' };

  const targetCap = capability(targetNode.kind);
  const accepting = targetCap.slots.filter((s) => s.accepts.includes(outputType));

  if (doc.edges.some((e) => e.source === source && e.target === target)) {
    return { ok: false, reason: 'duplicate' };
  }
  if (wouldCreateCycle(doc, source, target)) return { ok: false, reason: 'cycle' };

  if (targetHandle) {
    const slot = targetCap.slots.find((s) => s.id === targetHandle);
    if (!slot || !slot.accepts.includes(outputType)) {
      return { ok: false, reason: 'type-mismatch' };
    }
    // An occupied named slot is fine: applyConnect replaces the old edge.
    return { ok: true, slot: slot.id };
  }

  if (accepting.length === 0) return { ok: false, reason: 'type-mismatch' };

  const occupied = new Set(doc.edges.filter((e) => e.target === target).map((e) => e.targetHandle));
  const free = accepting.find((s) => !occupied.has(s.id));
  if (!free) return { ok: false, reason: 'no-free-slot' };

  return { ok: true, slot: free.id };
}

export function edgeId(source: string, slot: SlotId, target: string): string {
  return `e-${source}:${slot}:${target}`;
}

export function applyConnect(doc: GraphDoc, candidate: ConnectCandidate): GraphDoc {
  const result = canConnect(doc, candidate);
  if (!result.ok) {
    throw new Error(`Invalid connection ${candidate.source} -> ${candidate.target}: ${result.reason}`);
  }
  const slot = result.slot;
  // A targeted drop on an occupied slot replaces the old binding in the same
  // action, deterministically.
  const edges = doc.edges.filter((e) => !(e.target === candidate.target && e.targetHandle === slot));
  const next: EdgeDoc = {
    id: edgeId(candidate.source, slot, candidate.target),
    source: candidate.source,
    sourceHandle: 'out',
    target: candidate.target,
    targetHandle: slot,
  };
  return { ...doc, edges: [...edges, next] };
}

export function removeEdge(doc: GraphDoc, id: string): GraphDoc {
  return { ...doc, edges: doc.edges.filter((e) => e.id !== id) };
}
