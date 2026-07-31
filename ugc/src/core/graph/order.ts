// Topological order and run-plan resolution: Run all / Run From Here /
// Run Till Here / Run Group / single, as pure functions.
//
// Default force:false. A metered paid product must never silently re-burn
// credits on a node whose output is already fresh: fresh nodes resolve to
// 'reuse'. "Run again" on one node is {mode:'single'} with force:true.

import { isGenerator } from './capabilities';
import { estimateNodeCredits } from './credits';
import { isRunnable, isStale, type NotRunnableCode } from './gating';
import type { GraphDoc } from './types';

export type TopoResult = { order: string[] } | { cycle: string[] };

export function topoOrder(doc: GraphDoc): TopoResult {
  const ids = doc.nodes.map((n) => n.id);
  const indegree = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const e of doc.edges) {
    if (indegree.has(e.target)) indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
  }
  // Deterministic: ready nodes leave in id order (tests pin this).
  const ready = ids.filter((id) => (indegree.get(id) ?? 0) === 0).sort();
  const order: string[] = [];
  const remaining = new Set(ids);

  while (ready.length) {
    const id = ready.shift()!;
    order.push(id);
    remaining.delete(id);
    const unlocked: string[] = [];
    for (const e of doc.edges) {
      if (e.source !== id) continue;
      const next = (indegree.get(e.target) ?? 0) - 1;
      indegree.set(e.target, next);
      if (next === 0) unlocked.push(e.target);
    }
    ready.push(...unlocked.sort());
    ready.sort();
  }

  if (remaining.size) return { cycle: [...remaining].sort() };
  return { order };
}

function descendants(doc: GraphDoc, nodeId: string): Set<string> {
  const out = new Set<string>([nodeId]);
  const stack = [nodeId];
  while (stack.length) {
    const current = stack.pop()!;
    for (const e of doc.edges) {
      if (e.source === current && !out.has(e.target)) {
        out.add(e.target);
        stack.push(e.target);
      }
    }
  }
  return out;
}

function ancestors(doc: GraphDoc, nodeId: string): Set<string> {
  const out = new Set<string>([nodeId]);
  const stack = [nodeId];
  while (stack.length) {
    const current = stack.pop()!;
    for (const e of doc.edges) {
      if (e.target === current && !out.has(e.source)) {
        out.add(e.source);
        stack.push(e.source);
      }
    }
  }
  return out;
}

export type RunRequest =
  | { mode: 'all' }
  | { mode: 'from'; nodeId: string }
  | { mode: 'till'; nodeId: string }
  | { mode: 'group'; groupId: string }
  | { mode: 'single'; nodeId: string };

export interface PlanEntry {
  nodeId: string;
  action: 'run' | 'reuse' | 'blocked';
  reason?: NotRunnableCode;
  detail?: string;
  estimatedCredits: number;
}

export interface RunPlan {
  entries: PlanEntry[];
  totalCredits: number;
}

export function resolveRun(doc: GraphDoc, req: RunRequest, opts: { force?: boolean } = {}): RunPlan {
  const topo = topoOrder(doc);
  if ('cycle' in topo) {
    return {
      entries: topo.cycle.map((nodeId) => ({
        nodeId,
        action: 'blocked',
        reason: 'invalid-config',
        detail: 'This flow contains a loop',
        estimatedCredits: 0,
      })),
      totalCredits: 0,
    };
  }

  let targets: Set<string>;
  switch (req.mode) {
    case 'all':
      targets = new Set(doc.nodes.map((n) => n.id));
      break;
    case 'from':
      targets = descendants(doc, req.nodeId);
      break;
    case 'till':
      targets = ancestors(doc, req.nodeId);
      break;
    case 'group':
      targets = new Set(doc.nodes.filter((n) => n.groupId === req.groupId).map((n) => n.id));
      break;
    case 'single':
      targets = new Set([req.nodeId]);
      break;
  }

  const force = opts.force ?? false;
  const entries: PlanEntry[] = [];
  // Nodes earlier in this plan whose outputs will be fresh by the time a
  // downstream runs (either they run in-plan, or they are reused fresh).
  const assumeFresh = new Set<string>();

  for (const nodeId of topo.order) {
    if (!targets.has(nodeId)) continue;
    const node = doc.nodes.find((n) => n.id === nodeId)!;
    if (!isGenerator(node.kind)) continue;

    const fresh = node.output !== null && !isStale(doc, nodeId);
    if (fresh && !force) {
      // Reused nodes are NOT added to assumeFresh: their real output (and any
      // approval on it) stands, so downstream checks read the doc directly.
      // assumeFresh is only for nodes producing a NEW output in this plan.
      entries.push({ nodeId, action: 'reuse', estimatedCredits: 0 });
      continue;
    }

    const runnable = isRunnable(doc, nodeId, { assumeFresh });
    if (runnable.ok) {
      assumeFresh.add(nodeId);
      entries.push({ nodeId, action: 'run', estimatedCredits: estimateNodeCredits(doc, nodeId) });
    } else {
      entries.push({
        nodeId,
        action: 'blocked',
        reason: runnable.code,
        detail: runnable.detail,
        estimatedCredits: 0,
      });
    }
  }

  return {
    entries,
    totalCredits: entries.reduce((sum, e) => sum + e.estimatedCredits, 0),
  };
}
