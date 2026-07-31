// The job state machine: legal transitions only, bounded transport retries,
// content rejections terminal immediately, and the stale rule that ADOPTS
// provider tasks instead of resubmitting them (a resubmit double-bills).

import { describe, it, expect } from 'vitest';
import {
  TRANSITIONS,
  canTransition,
  assertTransition,
  isTerminalFailure,
  staleAction,
  MAX_TRANSPORT_ATTEMPTS,
  STALE_AFTER_MINUTES,
  type JobStatus,
} from '../../src/core/jobStates';

describe('transitions', () => {
  it('the happy paths are legal', () => {
    expect(canTransition('queued', 'submitted')).toBe(true);
    expect(canTransition('submitted', 'running')).toBe(true);
    expect(canTransition('running', 'stitching')).toBe(true);
    expect(canTransition('stitching', 'succeeded')).toBe(true);
    // Sync providers skip submitted.
    expect(canTransition('queued', 'running')).toBe(true);
  });

  it('terminal states go nowhere', () => {
    for (const from of ['succeeded', 'failed', 'canceled'] as JobStatus[]) {
      expect(TRANSITIONS[from]).toHaveLength(0);
    }
  });

  it('illegal transitions throw with both states named', () => {
    expect(() => assertTransition('succeeded', 'queued')).toThrow(/succeeded -> queued/);
    expect(() => assertTransition('queued', 'stitching')).toThrow();
  });

  it('cancel is only possible while still queued (after submission money is spent)', () => {
    expect(canTransition('queued', 'canceled')).toBe(true);
    expect(canTransition('submitted', 'canceled')).toBe(false);
    expect(canTransition('running', 'canceled')).toBe(false);
  });
});

describe('failure classification', () => {
  it('content rejections are terminal on the first attempt', () => {
    expect(isTerminalFailure('content-rejection', 1)).toBe(true);
  });

  it('transport errors retry up to the cap and then stop', () => {
    expect(isTerminalFailure('transport', 1)).toBe(false);
    expect(isTerminalFailure('transport', MAX_TRANSPORT_ATTEMPTS - 1)).toBe(false);
    expect(isTerminalFailure('transport', MAX_TRANSPORT_ATTEMPTS)).toBe(true);
  });
});

describe('stale jobs', () => {
  const now = Date.parse('2026-07-31T12:00:00Z');
  const stale = now - (STALE_AFTER_MINUTES + 1) * 60_000;
  const recent = now - 60_000;

  it('a stale job WITH a provider task is adopted, never resubmitted', () => {
    expect(staleAction({ status: 'running', providerTaskId: 'task-1', heartbeatAtMs: stale }, now)).toBe('adopt');
  });

  it('a stale job that never reached the provider is requeued', () => {
    expect(staleAction({ status: 'submitted', providerTaskId: null, heartbeatAtMs: stale }, now)).toBe('requeue');
  });

  it('recent heartbeats and settled jobs are left alone', () => {
    expect(staleAction({ status: 'running', providerTaskId: 'task-1', heartbeatAtMs: recent }, now)).toBe('none');
    expect(staleAction({ status: 'succeeded', providerTaskId: 'task-1', heartbeatAtMs: stale }, now)).toBe('none');
    expect(staleAction({ status: 'queued', providerTaskId: null, heartbeatAtMs: stale }, now)).toBe('none');
  });
});
