// Runnability, staleness and the approval gate, all DERIVED from the doc.
//
// The voice gate is not a special case: any slot whose spec says
// requiresApprovedUpstream demands that the upstream's CURRENT output be the
// approved one (approval.approvedAssetId === output.assetRef.assetId). A
// re-generated voice has a new assetId, so its gate closes by itself.
//
// This client-side check is UX. The server re-enforces the same rule inside
// the enqueue RPC in the same transaction as the debit: billing safety never
// depends on this file.

import { capability, isGenerator } from './capabilities';
import type { GraphDoc, NodeDoc } from './types';
import { incomingEdges, nodeById } from './types';

export type NotRunnableCode =
  | 'not-a-generator'
  | 'invalid-config'
  | 'missing-required-input'
  | 'upstream-unrun'
  | 'upstream-stale'
  | 'unapproved-audio';

export type Runnable = { ok: true } | { ok: false; code: NotRunnableCode; detail: string };

// djb2. Not cryptographic and does not need to be: the hash only answers
// "did the inputs change since this output was produced".
function djb2(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}

// Hash of everything a run would consume: the node's config plus, per bound
// slot, the upstream's current output asset id (or null if unrun).
export function hashInputs(doc: GraphDoc, nodeId: string): string {
  const node = nodeById(doc, nodeId);
  if (!node) return 'missing-node';
  const slots: Record<string, string | null> = {};
  for (const e of incomingEdges(doc, nodeId)) {
    const upstream = nodeById(doc, e.source);
    slots[e.targetHandle] = upstream?.output?.assetRef.assetId ?? null;
  }
  return djb2(stableStringify({ config: node.config, slots }));
}

export function isStale(doc: GraphDoc, nodeId: string): boolean {
  const node = nodeById(doc, nodeId);
  if (!node?.output) return false;
  // Assets and other non-generators are filled by upload, not produced from
  // inputs: they have nothing to go stale against.
  if (!isGenerator(node.kind)) return false;
  return node.output.inputsHash !== hashInputs(doc, nodeId);
}

function configProblem(node: NodeDoc): string | null {
  for (const field of capability(node.kind).fields) {
    if (!field.required) continue;
    const value = node.config[field.id];
    if (typeof value !== 'string' || value.trim() === '') {
      return `${field.label} is required`;
    }
  }
  return null;
}

export interface RunnableOptions {
  // Node ids whose outputs can be assumed fresh because they run earlier in
  // the same plan (resolveRun uses this; direct UI checks do not).
  assumeFresh?: Set<string>;
}

export function isRunnable(doc: GraphDoc, nodeId: string, opts: RunnableOptions = {}): Runnable {
  const node = nodeById(doc, nodeId);
  if (!node) return { ok: false, code: 'not-a-generator', detail: 'Unknown node' };
  if (!isGenerator(node.kind)) {
    return { ok: false, code: 'not-a-generator', detail: `${node.kind} nodes are filled, not run` };
  }

  const invalid = configProblem(node);
  if (invalid) return { ok: false, code: 'invalid-config', detail: invalid };

  const cap = capability(node.kind);
  const edges = incomingEdges(doc, nodeId);
  const boundSlots = new Map(edges.map((e) => [e.targetHandle, e] as const));
  const assumeFresh = opts.assumeFresh ?? new Set<string>();

  for (const slot of cap.slots) {
    const edge = boundSlots.get(slot.id);
    if (!edge) {
      if (slot.required) {
        return { ok: false, code: 'missing-required-input', detail: `${slot.label} is not connected` };
      }
      continue;
    }

    const upstream = nodeById(doc, edge.source);
    if (!upstream) {
      return { ok: false, code: 'missing-required-input', detail: `${slot.label} feeds from a missing node` };
    }

    const fresh = assumeFresh.has(upstream.id);
    if (!fresh) {
      if (!upstream.output) {
        return { ok: false, code: 'upstream-unrun', detail: `${upstream.label} has not run yet` };
      }
      if (isStale(doc, upstream.id)) {
        return { ok: false, code: 'upstream-stale', detail: `${upstream.label} is out of date` };
      }
    }

    if (slot.requiresApprovedUpstream) {
      // Approval must reference the upstream's CURRENT output. A node running
      // fresh in the same plan cannot be approved mid-plan, so assumeFresh
      // does not bypass the gate.
      const approvedId = upstream.approval?.approvedAssetId ?? null;
      const currentId = upstream.output?.assetRef.assetId ?? null;
      if (fresh || !currentId || approvedId !== currentId) {
        return {
          ok: false,
          code: 'unapproved-audio',
          detail: `${upstream.label} needs your approval before this can run`,
        };
      }
    }
  }

  return { ok: true };
}
