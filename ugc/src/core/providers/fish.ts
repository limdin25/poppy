// Fish Audio request builders, pure (no env, no network) so both the
// serverless voice routes and the VPS worker share one tested shape.
//
// The call shape is proven in this repo (api/fish/preview.ts, bridge/ai.py).
// prosody.speed 1.2 is MANDATORY: Fish s2.1 speaks slow and every measured
// deployment runs at 1.2 (see credentials_fish_audio). The test asserts it
// on every payload this module can produce.

export const FISH_TTS_URL = 'https://api.fish.audio/v1/tts';
export const FISH_MODEL_URL = 'https://api.fish.audio/model';
export const FISH_MODEL = 's2.1-pro';
export const FISH_SPEED = 1.2;
export const MAX_TAKE_CHARS = 1200;

export interface FishTtsRequest {
  url: string;
  headers: Record<string, string>;
  body: {
    text: string;
    reference_id: string;
    format: 'wav';
    sample_rate: number;
    normalize: boolean;
    latency: 'low';
    prosody: { speed: number; normalize_loudness: boolean };
  };
}

export function buildTtsRequest(args: {
  apiKey: string;
  text: string;
  referenceId: string;
  sampleRate?: number;
}): FishTtsRequest {
  const text = args.text.trim();
  if (!text) throw new Error('Nothing to say');
  if (text.length > MAX_TAKE_CHARS) {
    throw new Error(`A take caps at ${MAX_TAKE_CHARS} characters; split the script`);
  }
  if (!args.referenceId) throw new Error('A voice must be chosen first');
  return {
    url: FISH_TTS_URL,
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      'Content-Type': 'application/json',
      model: FISH_MODEL,
    },
    body: {
      text,
      reference_id: args.referenceId,
      format: 'wav',
      sample_rate: args.sampleRate ?? 44100,
      normalize: true,
      latency: 'low',
      prosody: { speed: FISH_SPEED, normalize_loudness: true },
    },
  };
}

export function buildCloneRequest(args: { apiKey: string; title: string }): {
  url: string;
  headers: Record<string, string>;
  fields: Record<string, string>;
} {
  if (!args.title.trim()) throw new Error('Name the voice first');
  return {
    url: FISH_MODEL_URL,
    headers: { Authorization: `Bearer ${args.apiKey}` },
    fields: { title: args.title.trim(), train_mode: 'fast', visibility: 'private' },
  };
}

// Duration from a 16-bit mono PCM wav: (bytes - 44 header) / (rate * 2).
export function wavDurationSeconds(byteLength: number, sampleRate: number): number {
  const pcmBytes = Math.max(0, byteLength - 44);
  return pcmBytes / (sampleRate * 2);
}
