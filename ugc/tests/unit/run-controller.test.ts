// The run controller against a scripted fake backend: submits in plan order
// only after upstreams settle, stamps the inputs hash at submit time, halts
// descendants on failure, and never touches blocked or reused entries.

import { describe, it, expect } from 'vitest';
import { executePlan, resolveInputs } from '../../src/core/run/runController';
import { resolveRun } from '../../src/core/graph/order';
import { hashInputs } from '../../src/core/graph/gating';
import { applyConnect } from '../../src/core/graph/connect';
import { doc, node, output, asset } from './helpers/build';
import type { GraphDoc, OutputRecord, RunState } from '../../src/core/graph/types';
import type { JobInfo, SubmitJobArgs, UgcBackend } from '../../src/core/persistence/backend';

function pipelineDoc(): GraphDoc {
  let d = doc({
    nodes: [
      node('influencer', 'asset', { output: output({ assetRef: asset({ assetId: 'a-inf' }) }) }),
      node('product', 'asset', { output: output({ assetRef: asset({ assetId: 'a-prod' }) }) }),
      node('composite', 'photo', { config: { prompt: 'scene' } }),
      node('vox', 'voice', {
        config: { script: 'hello there', voiceId: 'v-1' },
      }),
      node('vid', 'video', { config: {} }),
    ],
  });
  d = applyConnect(d, { source: 'influencer', target: 'composite', targetHandle: 'refImage1' });
  d = applyConnect(d, { source: 'product', target: 'composite', targetHandle: 'refImage2' });
  d = applyConnect(d, { source: 'composite', target: 'vid', targetHandle: 'startImage' });
  d = applyConnect(d, { source: 'vox', target: 'vid', targetHandle: 'audio' });
  return d;
}

class FakeBackend implements Pick<UgcBackend, 'submitJob' | 'getJob'> {
  submitted: SubmitJobArgs[] = [];
  failNodes = new Set<string>();
  private jobs = new Map<string, JobInfo>();
  private n = 0;

  async submitJob(args: SubmitJobArgs): Promise<{ jobId: string }> {
    this.submitted.push(args);
    this.n += 1;
    const jobId = `j-${this.n}`;
    if (this.failNodes.has(args.nodeId)) {
      this.jobs.set(jobId, { jobId, nodeId: args.nodeId, status: 'failed', error: 'provider said no' });
    } else {
      const out: OutputRecord = {
        assetRef: {
          assetId: `out-${args.nodeId}`,
          mime: 'image/png',
          ...(args.kind === 'voice' ? { durationSec: 10, mime: 'audio/wav' } : {}),
        },
        category: args.kind === 'voice' ? 'audio' : args.kind === 'video' ? 'video' : 'image',
        producedAt: 'now',
        jobId,
        creditsSpent: args.estimatedCredits,
        inputsHash: args.inputsHash,
      };
      this.jobs.set(jobId, { jobId, nodeId: args.nodeId, status: 'succeeded', output: out });
    }
    return { jobId };
  }

  async getJob(jobId: string): Promise<JobInfo> {
    return this.jobs.get(jobId)!;
  }
}

function harness(d: GraphDoc, backend: FakeBackend) {
  let current = d;
  const states: Array<[string, RunState]> = [];
  return {
    doc: () => current,
    states,
    onNodeState: (nodeId: string, state: RunState) => states.push([nodeId, state]),
    onOutput: (nodeId: string, out: OutputRecord) => {
      current = {
        ...current,
        nodes: current.nodes.map((n) => (n.id === nodeId ? { ...n, output: out } : n)),
      };
      // Approving the fresh voice take immediately, as a user would before a
      // combined run is even possible; keeps the happy path testable.
      if (nodeId === 'vox') {
        current = {
          ...current,
          nodes: current.nodes.map((n) =>
            n.id === 'vox' ? { ...n, approval: { approvedAt: 'now', approvedAssetId: out.assetRef.assetId } } : n,
          ),
        };
      }
    },
    backend: backend as unknown as UgcBackend,
  };
}

describe('executePlan', () => {
  it('runs composite then voice, wiring upstream outputs into downstream submissions', async () => {
    const d = pipelineDoc();
    const backend = new FakeBackend();
    const h = harness(d, backend);
    // First pass: video is blocked (voice unapproved when the plan resolved).
    const plan = resolveRun(d, { mode: 'all' });
    await executePlan({ ...h, plan, backend: h.backend, pollMs: 1 });

    expect(backend.submitted.map((s) => s.nodeId)).toEqual(['composite', 'vox']);
    // Second pass after approval: video runs and its start image is the
    // composite's REAL output from this session.
    const plan2 = resolveRun(h.doc(), { mode: 'all' });
    await executePlan({ ...h, plan: plan2, backend: h.backend, pollMs: 1 });
    const vidSubmit = backend.submitted.find((s) => s.nodeId === 'vid')!;
    expect(vidSubmit.resolvedInputs.startImage?.assetId).toBe('out-composite');
    expect(vidSubmit.resolvedInputs.audio?.assetId).toBe('out-vox');
    // Billed by the real audio duration (10s x 20cr).
    expect(vidSubmit.estimatedCredits).toBe(200);
  });

  it('stamps the inputs hash at submit time so freshness survives the round trip', async () => {
    const d = pipelineDoc();
    const backend = new FakeBackend();
    const h = harness(d, backend);
    await executePlan({ ...h, plan: resolveRun(d, { mode: 'all' }), backend: h.backend, pollMs: 1 });
    const compositeNode = h.doc().nodes.find((n) => n.id === 'composite')!;
    expect(compositeNode.output!.inputsHash).toBe(hashInputs(h.doc(), 'composite'));
  });

  it('a failed node halts its planned descendants but not independent branches', async () => {
    const d = pipelineDoc();
    const backend = new FakeBackend();
    backend.failNodes.add('composite');
    const h = harness(d, backend);
    await executePlan({ ...h, plan: resolveRun(d, { mode: 'all' }), backend: h.backend, pollMs: 1 });
    // Voice is independent of the composite and still ran.
    expect(backend.submitted.map((s) => s.nodeId)).toEqual(['composite', 'vox']);
    expect(h.states).toContainEqual(['composite', 'failed']);
  });

  it('reused and blocked entries never submit', async () => {
    let d = pipelineDoc();
    const backend = new FakeBackend();
    const h0 = harness(d, backend);
    await executePlan({ ...h0, plan: resolveRun(d, { mode: 'all' }), backend: h0.backend, pollMs: 1 });
    d = h0.doc();
    const submittedBefore = backend.submitted.length;
    // Everything fresh: the next Run All reuses composite + vox, runs only vid.
    const h1 = harness(d, backend);
    await executePlan({ ...h1, plan: resolveRun(d, { mode: 'all' }), backend: h1.backend, pollMs: 1 });
    expect(backend.submitted.slice(submittedBefore).map((s) => s.nodeId)).toEqual(['vid']);
  });

  it('resolveInputs maps bound slots to upstream output asset refs', () => {
    const d = pipelineDoc();
    const inputs = resolveInputs(d, 'composite');
    expect(inputs.refImage1?.assetId).toBe('a-inf');
    expect(inputs.refImage2?.assetId).toBe('a-prod');
  });
});
