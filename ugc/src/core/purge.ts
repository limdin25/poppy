// Pure purge decisions for the worker's 03:00 pass. The rule that matters
// most is what purging must NEVER touch: an approved asset or a finished ad.
// Storage is the thing that took Elsie down on 2026-06-02, so old rejected
// takes and stitch leftovers do get cleaned, conservatively.

export const PURGE_REJECTED_AFTER_DAYS = 7;
export const PURGE_CHUNKS_AFTER_HOURS = 24;
export const PURGE_BENCH_AFTER_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PurgeAssetRow {
  kind: string;
  approval_status: string;
  purged_at: string | null;
  created_at: string;
}

export function shouldPurgeAsset(asset: PurgeAssetRow, nowMs: number): boolean {
  if (asset.purged_at) return false;
  if (asset.approval_status === 'approved') return false;
  // Finished ads are the product the user paid for; age never purges them.
  if (asset.kind === 'lipsync_video' || asset.kind === 'final_video') return false;
  if (asset.approval_status !== 'rejected' && asset.approval_status !== 'superseded') return false;
  return nowMs - Date.parse(asset.created_at) > PURGE_REJECTED_AFTER_DAYS * DAY_MS;
}

// Chunk intermediates are re-derivable from the approved voice; they only
// need to outlive their job long enough for debugging a bad stitch.
export function shouldPurgeChunk(jobFinishedAt: string | null, nowMs: number): boolean {
  if (!jobFinishedAt) return false;
  return nowMs - Date.parse(jobFinishedAt) > PURGE_CHUNKS_AFTER_HOURS * 60 * 60 * 1000;
}

export function shouldPurgeBenchObject(createdAt: string, nowMs: number): boolean {
  return nowMs - Date.parse(createdAt) > PURGE_BENCH_AFTER_DAYS * DAY_MS;
}

// The pass runs in the small hours and at most once a day.
export function purgeDue(nowLocalHour: number, lastRunAtMs: number | null, nowMs: number): boolean {
  if (nowLocalHour !== 3) return false;
  if (lastRunAtMs !== null && nowMs - lastRunAtMs < 20 * 60 * 60 * 1000) return false;
  return true;
}
