// Storage rules that must never drift:
// 1. Every object path starts with the owning user's id; both buckets' RLS
//    policies read (storage.foldername(name))[1] = auth.uid()::text.
// 2. The purge never touches an approved asset or a finished ad, at any age.

import { describe, it, expect } from 'vitest';
import {
  uploadObjectPath,
  compositePath,
  voiceTakePath,
  adVideoPath,
  chunkAudioPath,
  benchObjectPath,
  bucketForSource,
  pathOwner,
  isChunkIntermediate,
  isBenchObject,
} from '../../src/core/storagePaths';
import {
  shouldPurgeAsset,
  shouldPurgeChunk,
  shouldPurgeBenchObject,
  purgeDue,
  PURGE_REJECTED_AFTER_DAYS,
} from '../../src/core/purge';

const USER = '11111111-2222-3333-4444-555555555555';
const PROJECT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const JOB = '99999999-8888-7777-6666-555555555555';

const DAY = 24 * 3600 * 1000;
const NOW = Date.parse('2026-07-31T12:00:00Z');
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe('storage paths', () => {
  it('every per-user path puts the user id in the FIRST segment (RLS depends on it)', () => {
    for (const path of [
      uploadObjectPath(USER, PROJECT, 'photo.png'),
      compositePath(USER, PROJECT, JOB),
      voiceTakePath(USER, PROJECT, JOB),
      adVideoPath(USER, PROJECT, JOB),
      chunkAudioPath(USER, PROJECT, JOB, 2),
    ]) {
      expect(path.split('/')[0]).toBe(USER);
      expect(pathOwner(path)).toBe(USER);
    }
  });

  it('bench objects live outside any user folder', () => {
    const path = benchObjectPath('voice-s15.wav');
    expect(isBenchObject(path)).toBe(true);
    expect(pathOwner(path)).toBeNull();
  });

  it('chunk intermediates are recognizable and uploads route to the uploads bucket', () => {
    expect(isChunkIntermediate(chunkAudioPath(USER, PROJECT, JOB, 0))).toBe(true);
    expect(isChunkIntermediate(adVideoPath(USER, PROJECT, JOB))).toBe(false);
    expect(bucketForSource('upload')).toBe('ugc-uploads');
    expect(bucketForSource('generated')).toBe('ugc-renders');
  });
});

describe('purge decisions', () => {
  const base = { kind: 'voice_audio', purged_at: null as string | null };

  it('NEVER purges approved assets, at any age', () => {
    expect(
      shouldPurgeAsset({ ...base, approval_status: 'approved', created_at: iso(365 * DAY) }, NOW),
    ).toBe(false);
  });

  it('NEVER purges finished ads, regardless of status or age', () => {
    for (const kind of ['lipsync_video', 'final_video']) {
      expect(
        shouldPurgeAsset({ kind, approval_status: 'rejected', purged_at: null, created_at: iso(365 * DAY) }, NOW),
      ).toBe(false);
    }
  });

  it('purges rejected and superseded assets only past the age threshold', () => {
    for (const approval_status of ['rejected', 'superseded']) {
      expect(shouldPurgeAsset({ ...base, approval_status, created_at: iso(6 * DAY) }, NOW)).toBe(false);
      expect(
        shouldPurgeAsset({ ...base, approval_status, created_at: iso((PURGE_REJECTED_AFTER_DAYS + 1) * DAY) }, NOW),
      ).toBe(true);
    }
  });

  it('pending assets and already-purged rows are left alone', () => {
    expect(shouldPurgeAsset({ ...base, approval_status: 'pending', created_at: iso(30 * DAY) }, NOW)).toBe(false);
    expect(
      shouldPurgeAsset(
        { ...base, purged_at: iso(DAY), approval_status: 'rejected', created_at: iso(30 * DAY) },
        NOW,
      ),
    ).toBe(false);
  });

  it('chunk audio purges a day after its job finished, never before or without a finish', () => {
    expect(shouldPurgeChunk(null, NOW)).toBe(false);
    expect(shouldPurgeChunk(iso(23 * 3600 * 1000), NOW)).toBe(false);
    expect(shouldPurgeChunk(iso(25 * 3600 * 1000), NOW)).toBe(true);
  });

  it('bench objects purge after 30 days', () => {
    expect(shouldPurgeBenchObject(iso(29 * DAY), NOW)).toBe(false);
    expect(shouldPurgeBenchObject(iso(31 * DAY), NOW)).toBe(true);
  });

  it('the pass runs only at 03:00 local and at most once a day', () => {
    expect(purgeDue(3, null, NOW)).toBe(true);
    expect(purgeDue(2, null, NOW)).toBe(false);
    expect(purgeDue(3, NOW - 19 * 3600 * 1000, NOW)).toBe(false);
    expect(purgeDue(3, NOW - 25 * 3600 * 1000, NOW)).toBe(true);
  });
});
