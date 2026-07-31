// Load-time validation and repair. A corrupt saved doc must never brick the
// canvas: unknown references are dropped, cycles are broken by removing the
// newest offending edge, and every repair is reported so the UI can say what
// happened instead of silently rewriting history.

import { capability } from './capabilities';
import { topoOrder } from './order';
import type { GraphDoc } from './types';

export interface ValidationResult {
  doc: GraphDoc;
  repairs: string[];
}

export function validateDoc(input: GraphDoc): ValidationResult {
  if (input.version !== 1) {
    throw new Error(`Unsupported graph version: ${String(input.version)}`);
  }

  const repairs: string[] = [];
  const nodeIds = new Set(input.nodes.map((n) => n.id));
  const groupIds = new Set(input.groups.map((g) => g.id));

  // Nodes referencing missing groups float free instead of vanishing.
  const nodes = input.nodes.map((n) => {
    if (n.groupId && !groupIds.has(n.groupId)) {
      repairs.push(`Node ${n.id} referenced missing group ${n.groupId}`);
      return { ...n, groupId: null };
    }
    return n;
  });

  // Edges: endpoints must exist, the slot must exist on the target's
  // capability, the source must produce a type the slot accepts, ids must be
  // unique.
  const seenIds = new Set<string>();
  const edges = input.edges.filter((e) => {
    if (seenIds.has(e.id)) {
      repairs.push(`Duplicate edge id ${e.id}`);
      return false;
    }
    seenIds.add(e.id);
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) {
      repairs.push(`Edge ${e.id} references a missing node`);
      return false;
    }
    const source = nodes.find((n) => n.id === e.source)!;
    const target = nodes.find((n) => n.id === e.target)!;
    const outputType = capability(source.kind).outputType;
    const slot = capability(target.kind).slots.find((s) => s.id === e.targetHandle);
    if (!slot) {
      repairs.push(`Edge ${e.id} points at unknown slot ${e.targetHandle}`);
      return false;
    }
    if (!outputType || !slot.accepts.includes(outputType)) {
      repairs.push(`Edge ${e.id} type mismatch (${source.kind} -> ${e.targetHandle})`);
      return false;
    }
    return true;
  });

  let doc: GraphDoc = { ...input, nodes, edges };

  // Break cycles by dropping the newest offending edge until the graph sorts.
  let guard = doc.edges.length + 1;
  for (;;) {
    guard -= 1;
    if (guard < 0) throw new Error('Cycle repair did not converge');
    const topo = topoOrder(doc);
    if ('order' in topo) break;
    const cycleSet = new Set(topo.cycle);
    const offending = [...doc.edges].reverse().find((e) => cycleSet.has(e.source) && cycleSet.has(e.target));
    if (!offending) throw new Error('Cycle detected but no edge found to break it');
    repairs.push(`Removed edge ${offending.id} to break a loop`);
    doc = { ...doc, edges: doc.edges.filter((e) => e.id !== offending.id) };
  }

  return { doc, repairs };
}
