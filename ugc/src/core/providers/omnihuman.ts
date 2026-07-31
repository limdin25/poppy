// OmniHuman 1.5, the premium lip-sync contender (identity + full-body
// leader at 3x Kling Standard's price; wins only if clearly more real in the
// blind bake-off). fal route first: identical price to origin BytePlus, one
// key, no AK/SK signing. The BytePlus Vision signer (Volcengine SigV4
// variant) is deliberately NOT built until the bake-off proves OmniHuman
// worth it; if it wins, the signer becomes its own pure tested module.
// Capped ~30s per generation: longer scripts chunk-and-stitch (core/chunks).

import { buildFalSubmit, type FalRequest } from './fal';

// FLAG verified-at-bake-off: the fal slug for OmniHuman 1.5.
export const OMNIHUMAN_MODEL_PATH = 'fal-ai/bytedance/omnihuman/v1.5';
export const OMNIHUMAN_MAX_SECONDS = 30;

export function buildOmniHumanSubmit(args: {
  apiKey: string;
  imageUrl: string;
  audioUrl: string;
  prompt?: string;
}): FalRequest {
  if (!args.imageUrl) throw new Error('OmniHuman needs a start image');
  if (!args.audioUrl) throw new Error('OmniHuman needs the approved voice track');
  return buildFalSubmit({
    apiKey: args.apiKey,
    modelPath: OMNIHUMAN_MODEL_PATH,
    input: {
      image_url: args.imageUrl,
      audio_url: args.audioUrl,
      ...(args.prompt ? { prompt: args.prompt } : {}),
    },
  });
}
