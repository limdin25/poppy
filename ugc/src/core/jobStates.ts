// The job state machine, as data plus two decisions the worker must never
// improvise: when a failure is terminal (refund now) and what to do with a
// job whose worker died (adopt the provider task, never resubmit it: a
// resubmit double-bills).

export type JobStatus =
  | 'queued'
  | 'submitted'
  | 'running'
  | 'stitching'
  | 'succeeded'
  | 'failed'
  | 'canceled';

export const TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  // Sync providers (Gemini, Fish) jump straight to running.
  queued: ['submitted', 'running', 'canceled'],
  submitted: ['running', 'failed', 'queued'],
  running: ['stitching', 'succeeded', 'failed'],
  stitching: ['succeeded', 'failed'],
  succeeded: [],
  failed: [],
  canceled: [],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal job transition ${from} -> ${to}`);
  }
}

// Transport errors (timeouts, 5xx, rate limits) earn a bounded retry.
// Content rejections (provider refused the input) are terminal immediately:
// retrying the same input cannot succeed and would re-bill.
export type ErrorClass = 'transport' | 'content-rejection';

export const MAX_TRANSPORT_ATTEMPTS = 3;

export function isTerminalFailure(errorClass: ErrorClass, attempts: number): boolean {
  if (errorClass === 'content-rejection') return true;
  return attempts >= MAX_TRANSPORT_ATTEMPTS;
}

export interface StaleJobView {
  status: JobStatus;
  providerTaskId: string | null;
  heartbeatAtMs: number;
}

export const STALE_AFTER_MINUTES = 10;

// A job whose heartbeat went quiet: if the provider already has the task,
// ADOPT it and resume polling. Only a job that never reached the provider is
// safe to requeue.
export function staleAction(job: StaleJobView, nowMs: number): 'adopt' | 'requeue' | 'none' {
  if (job.status !== 'submitted' && job.status !== 'running') return 'none';
  if (nowMs - job.heartbeatAtMs < STALE_AFTER_MINUTES * 60_000) return 'none';
  return job.providerTaskId ? 'adopt' : 'requeue';
}
