// Multi-tenant fairness for the claim step, as a pure function the RPC
// mirrors. One user queueing ten renders must not starve everyone else.
//
// Pick order: among users under the active cap who have queued work, prefer
// the fewest active jobs, then the fewest total jobs in the system (so a
// newcomer's single job beats a bulk queuer at equal activity), then the
// oldest queued job. Every tie breaks deterministically.

import type { JobStatus } from './jobStates';

export interface SchedulableJob {
  id: string;
  userId: string;
  status: JobStatus;
  createdAt: string;
}

export const MAX_ACTIVE_PER_USER = 3;

const ACTIVE: readonly JobStatus[] = ['submitted', 'running', 'stitching'];

export function pickNextJob(jobs: SchedulableJob[]): string | null {
  const activeByUser = new Map<string, number>();
  const totalByUser = new Map<string, number>();
  for (const job of jobs) {
    totalByUser.set(job.userId, (totalByUser.get(job.userId) ?? 0) + 1);
    if (ACTIVE.includes(job.status)) {
      activeByUser.set(job.userId, (activeByUser.get(job.userId) ?? 0) + 1);
    }
  }

  const eligible = jobs.filter(
    (j) => j.status === 'queued' && (activeByUser.get(j.userId) ?? 0) < MAX_ACTIVE_PER_USER,
  );
  if (!eligible.length) return null;

  eligible.sort((a, b) => {
    const activeDiff = (activeByUser.get(a.userId) ?? 0) - (activeByUser.get(b.userId) ?? 0);
    if (activeDiff) return activeDiff;
    const totalDiff = (totalByUser.get(a.userId) ?? 0) - (totalByUser.get(b.userId) ?? 0);
    if (totalDiff) return totalDiff;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });

  return eligible[0]!.id;
}
