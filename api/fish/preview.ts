// Fish voice preview — synthesise a line and hand it back as playable WAV, so
// the Fish agent page can be tuned without dialling anybody.
//
// Server-side because the Fish key must never reach the browser.
//
// The important bit is `telephony`. When true this generates at 8 kHz, which is
// what the phone network actually carries, and returns exactly what the
// prospect would hear. Previewing at 44.1kHz flatters the voice and is the
// wrong thing to judge: a voice can sound lovely in a browser and be thin and
// quiet on a call, which is precisely the trap the library voices fall into
// (they arrive around -23 dBFS where a line wants about -17).
//
// Node handler style (IncomingMessage/ServerResponse), matching api/vsl/page.ts.
// The Web-API style did not deploy in this project.

import type { IncomingMessage, ServerResponse } from 'http';

const FISH_URL = 'https://api.fish.audio/v1/tts';

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const key = process.env.FISH_API_KEY;
  if (!key) return json(res, 500, { error: 'FISH_API_KEY is not set on the server.' });

  let body: Record<string, unknown>;
  try {
    body = JSON.parse((await readBody(req)) || '{}');
  } catch {
    return json(res, 400, { error: 'Bad JSON.' });
  }

  const text = String(body.text ?? '').trim();
  if (!text) return json(res, 400, { error: 'Nothing to say.' });
  if (text.length > 600) return json(res, 400, { error: 'Keep the preview under 600 characters.' });

  // Refused rather than defaulted. With no reference_id Fish generates a brand
  // new random voice per request, so a preview would not represent anything.
  const voice = String(body.voice_id ?? '').trim();
  if (!voice) {
    return json(res, 400, {
      error: 'Set a voice ID first. Without one Fish invents a different voice every time.',
    });
  }

  const num = (v: unknown, fallback: number) =>
    (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

  const telephony = body.telephony !== false;
  const payload = {
    text,
    reference_id: voice,
    format: 'wav',
    sample_rate: telephony ? 8000 : 44100,
    latency: 'low',
    normalize: true,
    chunk_length: num(body.chunk_length, 120),
    temperature: num(body.temperature, 0.7),
    top_p: num(body.top_p, 0.7),
    prosody: {
      speed: num(body.speed, 1.15),
      volume: num(body.volume, 6),
      normalize_loudness: true,
    },
  };

  const started = Date.now();
  let upstream: globalThis.Response;
  try {
    upstream = await fetch(FISH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        model: String(body.model ?? 's2.1-pro-free'),
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return json(res, 502, { error: `Could not reach Fish: ${(e as Error).message}` });
  }

  if (!upstream.ok) {
    const detail = (await upstream.text()).slice(0, 300);
    return json(res, 502, { error: `Fish returned ${upstream.status}: ${detail}` });
  }

  const audio = Buffer.from(await upstream.arrayBuffer());
  res.statusCode = 200;
  res.setHeader('Content-Type', 'audio/wav');
  res.setHeader('Cache-Control', 'no-store');
  // Surfaced in the UI so the tuning shows its own cost.
  res.setHeader('X-Fish-Ms', String(Date.now() - started));
  res.end(audio);
}
