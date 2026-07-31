// Fairness at claim time: a newcomer's single job is not stuck behind a bulk
// queuer, nobody exceeds the per-user active cap, and everything ties break
// deterministically.

import { describe, it, expect } from 'vitest';
import { pickNextJob, MAX_ACTIVE_PER_USER, type SchedulableJob } from '../../src/core/scheduler';

function job(id: string, userId: string, status: SchedulableJob['status'], createdAt: string): SchedulableJob {
  return { id, userId, status, createdAt };
}

describe('pickNextJob', () => {
  it('a newcomer with one job beats a bulk queuer at equal activity', () => {
    const jobs: SchedulableJob[] = [
      ...Array.from({ length: 10 }, (_, i) =>
        job(`bulk-${i}`, 'bulk', 'queued', `2026-07-31T10:0${i > 8 ? 9 : i}:00Z`),
      ),
      job('solo-1', 'solo', 'queued', '2026-07-31T11:00:00Z'),
    ];
    expect(pickNextJob(jobs)).toBe('solo-1');
  });

  it('fewest ACTIVE jobs wins first', () => {
    const jobs: SchedulableJob[] = [
      job('a-active', 'alice', 'running', '2026-07-31T09:00:00Z'),
      job('a-queued', 'alice', 'queued', '2026-07-31T09:01:00Z'),
      job('b-queued', 'bob', 'queued', '2026-07-31T11:59:00Z'),
    ];
    expect(pickNextJob(jobs)).toBe('b-queued');
  });

  it('a user at the active cap is skipped entirely', () => {
    const jobs: SchedulableJob[] = [
      ...Array.from({ length: MAX_ACTIVE_PER_USER }, (_, i) =>
        job(`a-active-${i}`, 'alice', 'running', '2026-07-31T09:00:00Z'),
      ),
      job('a-queued', 'alice', 'queued', '2026-07-31T09:01:00Z'),
    ];
    expect(pickNextJob(jobs)).toBeNull();
  });

  it('within one user, oldest queued job first', () => {
    const jobs: SchedulableJob[] = [
      job('newer', 'alice', 'queued', '2026-07-31T11:00:00Z'),
      job('older', 'alice', 'queued', '2026-07-31T10:00:00Z'),
    ];
    expect(pickNextJob(jobs)).toBe('older');
  });

  it('returns null when nothing is queued', () => {
    expect(pickNextJob([job('done', 'alice', 'succeeded', '2026-07-31T10:00:00Z')])).toBeNull();
    expect(pickNextJob([])).toBeNull();
  });
});
