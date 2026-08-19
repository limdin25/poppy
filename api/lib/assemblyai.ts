// AssemblyAI batch transcription for a finished call recording.
//
// Batch, not streaming, on purpose: after the call there is no clock, and the
// batch model is the one that measured best against Twilio on 2026-08-18
// (93% agreement with a reference transcript against Twilio's 86%, on three of
// Pedro's own property calls).
//
// THREE THINGS THEIR API WILL BITE YOU WITH, all measured, all handled here:
//   1. Auth is the RAW key with NO "Bearer " prefix. Their docs call this the
//      single most common integration mistake.
//   2. `speech_model` (singular) is DEPRECATED and 400s. It is `speech_models`,
//      an array.
//   3. With multichannel on, `channel` comes back as a STRING ('1' / '2'),
//      not a number. Comparing it to 1 silently puts every utterance on one
//      speaker, which is exactly how a transcript ends up claiming the agent
//      said everything the branch said.

const BASE = 'https://api.assemblyai.com/v2';

export type AaiUtterance = {
  /** '1' or '2' — which leg of the dual-channel recording. */
  channel: string;
  /** Milliseconds from the start of the recording. */
  start: number;
  text: string;
};

function key(): string {
  const k = (process.env.ASSEMBLYAI_API_KEY ?? '').trim();
  if (!k) throw new Error('ASSEMBLYAI_API_KEY is not set');
  return k;
}

async function call(path: string, init?: RequestInit): Promise<any> {
  const resp = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: key(), 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await resp.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
  if (!resp.ok) {
    throw new Error(`assemblyai ${path} ${resp.status}: ${json?.error ?? text.slice(0, 300)}`);
  }
  return json;
}

/**
 * Transcribe a recording that AssemblyAI can fetch for itself.
 *
 * `audioUrl` must be reachable without our credentials for the life of the
 * job — a Supabase signed URL is fine, as long as its TTL outlives the poll
 * loop below.
 */
export async function transcribeUrl(
  audioUrl: string,
  opts: { timeoutMs?: number; pollMs?: number } = {},
): Promise<AaiUtterance[]> {
  const timeoutMs = opts.timeoutMs ?? 10 * 60_000;
  const pollMs = opts.pollMs ?? 4_000;

  const job = await call('/transcript', {
    method: 'POST',
    body: JSON.stringify({
      audio_url: audioUrl,
      // One leg per channel, so the speaker is a fact about the audio rather
      // than a guess from diarisation.
      multichannel: true,
      speech_models: ['universal-2'],
      punctuate: true,
      format_text: true,
    }),
  });

  const id = job?.id;
  if (!id) throw new Error('assemblyai: no transcript id returned');

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (Date.now() > deadline) throw new Error(`assemblyai: timed out after ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, pollMs));
    const r = await call(`/transcript/${id}`);
    if (r?.status === 'error') throw new Error(`assemblyai: ${r?.error ?? 'transcription failed'}`);
    if (r?.status !== 'completed') continue;

    return ((r?.utterances ?? []) as Array<{ channel?: unknown; start?: unknown; text?: unknown }>)
      .map((u) => ({
        channel: String(u.channel ?? ''),
        start: Number(u.start ?? 0),
        text: String(u.text ?? '').trim(),
      }))
      .filter((u) => u.text.length > 0);
  }
}
