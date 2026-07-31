// Stage preconditions: the client-side mirror of what ugc_enqueue_job
// enforces server-side in the same transaction as the debit. The UI uses this
// for instant validation; the RPC re-checks everything because a hand-crafted
// request must not be able to bypass the gate.
//
// THE HARD GATE (Hugo's rule): lip-sync runs only from a voice recording the
// user explicitly approved. Voice generation is deliberately NOT gated on the
// composite: the flow allows photo work and voice work in parallel.

export type AssetKind =
  | 'influencer_photo'
  | 'product_photo'
  | 'composite_image'
  | 'voice_audio'
  | 'lipsync_video'
  | 'broll_video'
  | 'final_video';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'superseded';

export interface AssetLike {
  id: string;
  projectId: string;
  userId: string;
  kind: AssetKind;
  approvalStatus: ApprovalStatus;
  durationSeconds?: number;
}

export type JobStage = 'composite' | 'voice' | 'lipsync' | 'broll' | 'stitch';

export interface StageInput {
  influencerAssetId?: string;
  productAssetId?: string;
  compositeAssetId?: string;
  audioAssetId?: string;
}

export interface GateContext {
  stage: JobStage;
  projectId: string;
  userId: string;
  assets: AssetLike[];
  input: StageInput;
}

export type GateResult = { ok: true } | { ok: false; reason: string };

function findOwned(ctx: GateContext, assetId: string | undefined, kind: AssetKind): AssetLike | string {
  if (!assetId) return `Missing ${kind.replace(/_/g, ' ')}`;
  const asset = ctx.assets.find((a) => a.id === assetId);
  if (!asset) return `Asset ${assetId} does not exist`;
  if (asset.userId !== ctx.userId) return `Asset ${assetId} belongs to another user`;
  if (asset.projectId !== ctx.projectId) return `Asset ${assetId} belongs to another project`;
  if (asset.kind !== kind) return `Asset ${assetId} is a ${asset.kind}, expected ${kind}`;
  return asset;
}

export function checkStagePreconditions(ctx: GateContext): GateResult {
  switch (ctx.stage) {
    case 'composite': {
      for (const [id, kind] of [
        [ctx.input.influencerAssetId, 'influencer_photo'],
        [ctx.input.productAssetId, 'product_photo'],
      ] as const) {
        const found = findOwned(ctx, id, kind);
        if (typeof found === 'string') return { ok: false, reason: found };
      }
      return { ok: true };
    }

    case 'voice':
      return { ok: true };

    case 'lipsync': {
      const audio = findOwned(ctx, ctx.input.audioAssetId, 'voice_audio');
      if (typeof audio === 'string') return { ok: false, reason: audio };
      if (audio.approvalStatus !== 'approved') {
        return {
          ok: false,
          reason:
            audio.approvalStatus === 'superseded'
              ? 'That voice take was replaced by a newer one and is no longer approved'
              : 'The voice track must be approved before lip-sync can run',
        };
      }
      const composite = findOwned(ctx, ctx.input.compositeAssetId, 'composite_image');
      if (typeof composite === 'string') return { ok: false, reason: composite };
      return { ok: true };
    }

    case 'broll':
      return { ok: true };

    case 'stitch':
      return { ok: true };
  }
}
