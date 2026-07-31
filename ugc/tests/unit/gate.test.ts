// The stage preconditions the enqueue RPC will enforce, pinned here first:
// lip-sync demands an APPROVED voice take (superseded is not approved) plus a
// composite image, all owned by the same user in the same project.

import { describe, it, expect } from 'vitest';
import { checkStagePreconditions, type AssetLike } from '../../src/core/gate';

function assets(): AssetLike[] {
  return [
    { id: 'a-inf', projectId: 'p1', userId: 'u1', kind: 'influencer_photo', approvalStatus: 'pending' },
    { id: 'a-prod', projectId: 'p1', userId: 'u1', kind: 'product_photo', approvalStatus: 'pending' },
    { id: 'a-comp', projectId: 'p1', userId: 'u1', kind: 'composite_image', approvalStatus: 'approved' },
    { id: 'a-voice', projectId: 'p1', userId: 'u1', kind: 'voice_audio', approvalStatus: 'approved', durationSeconds: 28 },
    { id: 'a-voice-old', projectId: 'p1', userId: 'u1', kind: 'voice_audio', approvalStatus: 'superseded' },
    { id: 'a-voice-pending', projectId: 'p1', userId: 'u1', kind: 'voice_audio', approvalStatus: 'pending' },
    { id: 'a-other-project', projectId: 'p2', userId: 'u1', kind: 'voice_audio', approvalStatus: 'approved' },
    { id: 'a-other-user', projectId: 'p1', userId: 'u2', kind: 'voice_audio', approvalStatus: 'approved' },
  ];
}

function ctx(stage: 'composite' | 'voice' | 'lipsync', input: Record<string, string>) {
  return { stage, projectId: 'p1', userId: 'u1', assets: assets(), input };
}

describe('lipsync preconditions (THE hard gate)', () => {
  it('passes with an approved voice and a composite', () => {
    const r = checkStagePreconditions(ctx('lipsync', { audioAssetId: 'a-voice', compositeAssetId: 'a-comp' }));
    expect(r).toEqual({ ok: true });
  });

  it('rejects an unapproved (pending) voice', () => {
    const r = checkStagePreconditions(ctx('lipsync', { audioAssetId: 'a-voice-pending', compositeAssetId: 'a-comp' }));
    expect(r.ok).toBe(false);
  });

  it('rejects a previously-approved take that was superseded by a newer one', () => {
    const r = checkStagePreconditions(ctx('lipsync', { audioAssetId: 'a-voice-old', compositeAssetId: 'a-comp' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('replaced');
  });

  it('rejects a cross-project voice even when approved', () => {
    const r = checkStagePreconditions(ctx('lipsync', { audioAssetId: 'a-other-project', compositeAssetId: 'a-comp' }));
    expect(r.ok).toBe(false);
  });

  it('rejects another user\'s voice even when approved', () => {
    const r = checkStagePreconditions(ctx('lipsync', { audioAssetId: 'a-other-user', compositeAssetId: 'a-comp' }));
    expect(r.ok).toBe(false);
  });

  it('rejects a missing composite', () => {
    const r = checkStagePreconditions(ctx('lipsync', { audioAssetId: 'a-voice' }));
    expect(r.ok).toBe(false);
  });

  it('rejects an asset of the wrong kind wired as the audio', () => {
    const r = checkStagePreconditions(ctx('lipsync', { audioAssetId: 'a-comp', compositeAssetId: 'a-comp' }));
    expect(r.ok).toBe(false);
  });
});

describe('composite preconditions', () => {
  it('requires both photos', () => {
    expect(checkStagePreconditions(ctx('composite', { influencerAssetId: 'a-inf', productAssetId: 'a-prod' }))).toEqual({ ok: true });
    expect(checkStagePreconditions(ctx('composite', { influencerAssetId: 'a-inf' })).ok).toBe(false);
  });
});

describe('voice preconditions', () => {
  it('voice generation is NOT gated on the composite (parallel work allowed)', () => {
    expect(checkStagePreconditions(ctx('voice', {}))).toEqual({ ok: true });
  });
});
