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

export const config = { runtime: 'nodejs' };

const FISH_URL = 'https://api.fish.audio/v1/tts';

interface Body {
  text?: string;
  voice_id?: string;
  model?: string;
  speed?: number;
  volume?: number;
  temperature?: number;
  top_p?: number;
  chunk_length?: number;
  telephony?: boolean;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }
  const key = process.env.FISH_API_KEY;
  if (!key) {
    return Response.json({ error: 'FISH_API_KEY is not set on the server.' }, { status: 500 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: 'Bad JSON.' }, { status: 400 });
  }

  const text = (body.text ?? '').trim();
  if (!text) return Response.json({ error: 'Nothing to say.' }, { status: 400 });
  if (text.length > 600) return Response.json({ error: 'Keep the preview under 600 characters.' }, { status: 400 });

  // Refused rather than defaulted. With no reference_id Fish generates a brand
  // new random voice per request, so a preview would not represent anything.
  const voice = (body.voice_id ?? '').trim();
  if (!voice) {
    return Response.json(
      { error: 'Set a voice ID first. Without one Fish invents a different voice every time.' },
      { status: 400 },
    );
  }

  const telephony = body.telephony !== false;
  const payload = {
    text,
    reference_id: voice,
    format: 'wav',
    sample_rate: telephony ? 8000 : 44100,
    latency: 'low',
    normalize: true,
    chunk_length: body.chunk_length ?? 120,
    temperature: body.temperature ?? 0.7,
    top_p: body.top_p ?? 0.7,
    prosody: {
      speed: body.speed ?? 1.15,
      volume: body.volume ?? 6,
      normalize_loudness: true,
    },
  };

  const started = Date.now();
  const upstream = await fetch(FISH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      model: body.model ?? 's2.1-pro-free',
    },
    body: JSON.stringify(payload),
  });

  if (!upstream.ok) {
    const detail = (await upstream.text()).slice(0, 300);
    return Response.json({ error: `Fish returned ${upstream.status}: ${detail}` }, { status: 502 });
  }

  const audio = await upstream.arrayBuffer();
  return new Response(audio, {
    status: 200,
    headers: {
      'Content-Type': 'audio/wav',
      'Cache-Control': 'no-store',
      // Surfaced in the UI so the tuning shows its own cost.
      'X-Fish-Ms': String(Date.now() - started),
      'X-Fish-Bytes': String(audio.byteLength),
    },
  });
}
