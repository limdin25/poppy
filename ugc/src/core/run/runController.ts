// Executes a RunPlan against the backend, sequentially in plan order (the
// plan is already topological, so every upstream settles before its consumer
// submits). Failure semantics: a failed node marks every planned descendant
// blocked and skips them; independent branches keep going.

import type { RunPlan } from '../graph/order';
import { hashInputs } from '../graph/gating';
import type { AssetRef, GraphDoc, OutputRecord, RunState, SlotId } from '../graph/types';
import { incomingEdges, nodeById } from '../graph/types';
import type { SubmitJobArgs, UgcBackend } from '../persistence/backend';

export interface ExecuteOptions {
  // Always read the doc through this getter: upstream outputs written during
  // the run must be visible to downstream submissions.
  doc: () => GraphDoc;
  plan: RunPlan;
  backend: UgcBackend;
  onNodeState: (nodeId: string, state: RunState, detail?: string) => void;
  onOutput: (nodeId: string, output: OutputRecord) => void;
  pollMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function descendantsWithin(doc: GraphDoc, nodeId: string, within: Set<string>): string[] {
  const out: string[] = [];
  const stack = [nodeId];
  const seen = new Set<string>([nodeId]);
  while (stack.length) {
    const current = stack.pop()!;
    for (const e of doc.edges) {
      if (e.source === current && !seen.has(e.target)) {
        seen.add(e.target);
        if (within.has(e.target)) out.push(e.target);
        stack.push(e.target);
      }
    }
  }
  return out;
}

export function resolveInputs(doc: GraphDoc, nodeId: string): Partial<Record<SlotId, AssetRef>> {
  const inputs: Partial<Record<SlotId, AssetRef>> = {};
  for (const e of incomingEdges(doc, nodeId)) {
    const upstream = nodeById(doc, e.source);
    if (upstream?.output) inputs[e.targetHandle] = upstream.output.assetRef;
  }
  return inputs;
}

export async function executePlan(opts: ExecuteOptions): Promise<void> {
  const pollMs = opts.pollMs ?? 500;
  const runIds = new Set(opts.plan.entries.filter((e) => e.action === 'run').map((e) => e.nodeId));
  const skipped = new Set<string>();

  for (const entry of opts.plan.entries) {
    if (entry.action === 'blocked') {
      opts.onNodeState(entry.nodeId, 'idle', entry.detail);
      continue;
    }
    if (entry.action === 'reuse') continue;
    if (skipped.has(entry.nodeId)) continue;

    const doc = opts.doc();
    const node = nodeById(doc, entry.nodeId);
    if (!node) continue;

    opts.onNodeState(entry.nodeId, 'queued');
    const args: SubmitJobArgs = {
      projectId: doc.projectId,
      nodeId: entry.nodeId,
      kind: node.kind,
      config: node.config,
      resolvedInputs: resolveInputs(doc, entry.nodeId),
      estimatedCredits: entry.estimatedCredits,
      inputsHash: hashInputs(doc, entry.nodeId),
    };

    let jobId: string;
    try {
      const submitted = await opts.backend.submitJob(args);
      jobId = submitted.jobId;
    } catch (e) {
      opts.onNodeState(entry.nodeId, 'failed', (e as Error).message);
      for (const d of descendantsWithin(doc, entry.nodeId, runIds)) skipped.add(d);
      continue;
    }

    opts.onNodeState(entry.nodeId, 'running');
    for (;;) {
      const job = await opts.backend.getJob(jobId);
      if (job.status === 'succeeded' && job.output) {
        opts.onOutput(entry.nodeId, job.output);
        opts.onNodeState(entry.nodeId, 'done');
        break;
      }
      if (job.status === 'failed') {
        opts.onNodeState(entry.nodeId, 'failed', job.error ?? 'Generation failed');
        for (const d of descendantsWithin(opts.doc(), entry.nodeId, runIds)) skipped.add(d);
        break;
      }
      await sleep(pollMs);
    }
  }
}
