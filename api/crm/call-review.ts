// What went wrong on the call that just ended.
//
// Hugo 2026-08-12: "give an AI report as well, after every call. What he done
// wrong."
//
// Runs on the wrap-up screen, on the transcript of the call the agent has just
// hung up. It marks the call against the SAME rules the live coach works to,
// which are the rules in the property script: get a ballpark figure, never
// offer, never book a viewing, never say the walk-away number, always get the
// email, always agree a callback.
//
// It is a REVIEW, not a coach. The coach's job is to save the call while it is
// happening. This one is allowed to be blunt afterwards, because that is what
// makes the next call better.
//
// Nothing here decides anything. It writes sentences a human reads.

import { createClient } from '@supabase/supabase-js';
import { callLLM } from '../lib/llm.js';

export const config = { runtime: 'edge' };

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const MODEL = 'claude-sonnet-5';

const SYSTEM = [
  'You review one phone call. A property buyer\'s agent rang an ESTATE AGENT about a house.',
  '',
  'WHAT A GOOD CALL LOOKS LIKE, in order:',
  '1. Is it still available.',
  '2. Who am I speaking to, and permission for a couple of questions.',
  '3. Three questions only: is it empty, does it need work, why are they selling.',
  '4. THE MONEY. "If we were to offer around X, am I in the ballpark or a million miles off?" One figure, never a range, never "I would like to offer".',
  '5. Get THEIR figure: "what sort of figure do you think would actually get it done?"',
  '6. Everything else, only once the money went somewhere.',
  '7. Lock the next step: a video walkthrough, THE ESTATE AGENT\'S EMAIL ADDRESS, and an agreed time to ring back.',
  '',
  'THINGS THAT ARE ALWAYS WRONG:',
  '- Ending the call after the estate agent names a figure without banking it, putting it to the director and agreeing a callback. This is the worst mistake on this list.',
  '- Making a formal offer, or promising one. The agent is not authorised. It is always "I will speak to Hugo and come back to you".',
  '- Agreeing to view the property, or booking a viewing. We buy remotely: the builder views it and prices the work in one visit.',
  '- Saying the walk-away figure, or confirming a guess at it.',
  '- Saying a range instead of one number.',
  '- Hanging up without the estate agent\'s email address.',
  '- Hanging up without an agreed time to ring back.',
  '- Talking about Google reviews, websites, or anything that is not this house.',
  '- Sixteen questions before the money. Three, then the money.',
  '',
  'HOW TO WRITE IT:',
  '- Judge ONLY what is in the transcript. If the call never connected or barely started, say so and stop. Never invent a mistake to fill the page.',
  '- Be specific and quote the moment. "You asked about the lease before you asked about the money" beats "poor structure".',
  '- Plain British English, short sentences, no jargon, no scoring out of ten in the prose.',
  '- Blunt is fine. Rude is not. He is doing a hard job.',
  '- NEVER use a long dash. No em dash, no en dash. Use a comma or a full stop. No curly quotes.',
  '',
  'Return STRICT JSON and nothing else:',
  '{"verdict":"one sentence on how the call went","score":0-10,"gotTheFigure":true|false,"gotTheEmail":true|false,"gotACallback":true|false,"wentWell":["..."],"mistakes":[{"what":"...","shouldHaveSaid":"..."}],"nextCall":"one thing to do differently on the very next dial"}',
].join('\n');

interface Body { callId?: string }

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response(JSON.stringify({ error: 'bad json' }), { status: 400 });
  }
  if (!body.callId) {
    return new Response(JSON.stringify({ error: 'callId required' }), { status: 400 });
  }

  const { data } = await supabase
    .from('wk_live_transcripts')
    .select('speaker, text, created_at')
    .eq('call_id', body.callId)
    .order('created_at', { ascending: true })
    .limit(400);

  const lines = (data ?? [])
    .map((r: { speaker?: string | null; text?: string | null }) =>
      `${(r.speaker ?? 'other').toUpperCase()}: ${(r.text ?? '').trim()}`)
    .filter((l) => l.length > 8);

  // A call with four lines in it is a wrong number or a receptionist, and a
  // review of it would be invented rather than observed.
  if (lines.length < 6) {
    return new Response(
      JSON.stringify({ skipped: true, reason: 'Too little was said on this call to review it.' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const out = await callLLM(
    MODEL,
    SYSTEM,
    [{ role: 'user', content: `THE CALL:\n${lines.join('\n').slice(0, 24_000)}` }],
    1200,
  );

  if (!out) {
    return new Response(JSON.stringify({ error: 'The reviewer did not answer.' }), {
      status: 502, headers: { 'Content-Type': 'application/json' },
    });
  }

  // The model is told to return only JSON; it sometimes wraps it in a fence.
  const raw = out.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  } catch {
    return new Response(JSON.stringify({ error: 'The reviewer did not answer in a readable shape.' }), {
      status: 502, headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify(parsed), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
