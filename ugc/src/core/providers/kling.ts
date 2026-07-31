// Kling Avatar 2.0 Standard via fal: photo + approved voice track + a
// behavioral prompt -> talking video, single takes up to 5 minutes, so the
// default pipeline never stitches. The launch default lip-sync engine
// (bake-off confirms the slug and the REAL per-second bill before defaults
// lock; sources conflict at $0.044-0.115/s).

import { buildFalSubmit, type FalRequest } from './fal';

// FLAG verified-at-bake-off: the fal slug for Kling Avatar v2 Standard.
export const KLING_AVATAR_MODEL_PATH = 'fal-ai/kling-video/ai-avatar/v2/standard';

export function buildKlingAvatarSubmit(args: {
  apiKey: string;
  imageUrl: string;
  audioUrl: string;
  prompt?: string;
}): FalRequest {
  if (!args.imageUrl) throw new Error('Kling Avatar needs a start image');
  if (!args.audioUrl) throw new Error('Kling Avatar needs the approved voice track');
  return buildFalSubmit({
    apiKey: args.apiKey,
    modelPath: KLING_AVATAR_MODEL_PATH,
    input: {
      image_url: args.imageUrl,
      audio_url: args.audioUrl,
      ...(args.prompt ? { prompt: args.prompt } : {}),
    },
  });
}
