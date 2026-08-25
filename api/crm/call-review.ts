// What went wrong on the call that just ended.
//
// Hugo 2026-08-12: "give an AI report as well, after every call. What he done
// wrong."
//
// Runs on the wrap-up screen, on the transcript of the call the agent has just
// hung up. It marks the call against the SAME rules the live coach works to,
// which are the rules in the property script: on a first call get the facts and
// a day for our builder, say no number of ours, never offer, never book a
// viewing for himself, never say the walk-away number, always get the email,
// always agree a time.
//
// It is a REVIEW, not a coach. The coach's job is to save the call while it is
// happening. This one is allowed to be blunt afterwards, because that is what
// makes the next call better.
//
// Nothing here decides anything. It writes sentences a human reads.

import { createClient } from '@supabase/supabase-js';
import { callLLM } from '../lib/llm.js';
import { readCallTranscript, formatTranscript } from '../lib/call-transcript.js';

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
  '3. THREE QUESTIONS, cut to this by Hugo on 2026-08-25: is it vacant or tenanted; ONE condition question, said as "I have had a look at the photos so I have a rough idea, is there anything else I should know about it, any damp or leaks, anything with the roof, the boiler, anything that is just not working?"; and why are they selling, are they in a hurry. That is the whole of it.',
  '3b. THE HOUSE NUMBER, on every single call: "just so I can get my builder to the right door, what is the house number?" Rightmove publishes no house number on 96.6% of adverts, so what we hold is a street and a postcode, and a builder cannot be sent to a street. Missing it is the second worst miss on a first call, behind only the builder\'s day.',
  'OFF THE CALL AND NEVER A MISS: how long it has been on the market, whether the price came down, the floor area, what it would let for, what sold done up on the street, offers and rejections, freehold or leasehold, the big four, the age of the kitchen and bathroom, double glazing, and who has priced the work up. The homework is done before the call and our builder measures the rest. If the branch volunteers one, that is a bonus worth praising, never a step.',
  '4. Offers and rejections: has anything been turned down, and at what level. He does NOT ask what figure would get it done, that was removed on 2026-08-20, and asking for it is not a step on a first call.',
  '5. BOOK THE BUILDER (changed by Hugo on 2026-08-20, and this is now the close of a first call). "The next thing our side is quick: we send our own builder round to price the work up. When would suit for access?" Then a day, and who holds the keys. On a FIRST call he says NO NUMBER OF OURS AT ALL: there is no ballpark and no system figure any more, and saying none is correct play, never a miss. A number of ours on a first call is a mistake however it was framed.',
  '6. Everything else, only once the builder\'s day has been asked for.',
  '7. Lock the next step: THE ESTATE AGENT\'S EMAIL ADDRESS, and an agreed time to ring back or confirm the builder. A video walkthrough is asked for ONLY when no builder day was agreed, and the floor plan is never asked for, we already hold it. Do not mark a call down for skipping either.',
  '',
  'THINGS THAT ARE ALWAYS WRONG:',
  '- Ending the call after the estate agent names a figure without banking it, putting it to the director and agreeing a callback. This is the worst mistake on this list.',
  '- Making a formal offer, or promising one. The agent is not authorised. It is always "I will speak to Hugo and come back to you".',
  '- Agreeing to view the property HIMSELF, or booking a viewing for himself or the director. We buy remotely: our builder views it and prices the work in one visit, and booking HIM in is the right thing, never a mistake.',
  '- Ending a first call without asking for a day for the builder. That is the close and it is the most common miss.',
  '- Ending a first call without the HOUSE NUMBER. The builder invite goes out with a street and a postcode on it, and that is exactly how the Lunar Builders viewing was lost on 21 August: Shakeel asked for the full address, waited 41 hours, and cancelled on the morning.',
  '- Saying the walk-away figure, or confirming a guess at it.',
  '- Saying a range instead of one number.',
  '- Hanging up without the estate agent\'s email address.',
  '- Hanging up without an agreed time to ring back.',
  '- Talking about Google reviews, websites, or anything that is not this house.',
  '- Sixteen questions before he asks for the builder. Get the facts, then ask for the day.',
  '- PUSHING AWAY AN APPOINTMENT THEY OFFERED (added 2026-08-24). If the branch says any version of "would you like me to book you in?" and he answers "before I book, let me ask a few questions first", that is a mistake and one of the worst on this list. A day in the diary cannot be lost to a bad line or a hang-up, and the questions can always be asked afterwards. Quote both sides and tell him: say yes, take the day, then ask.',
  '- Saying out loud that he has not looked at the listing ("I\'m looking at a spreadsheet", "I\'m not on the website"). It has cost whole calls. The advert is open before he dials.',
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

  // ONE reader owns this now (api/lib/call-transcript.ts), which is what stops
  // the fourth sighting of the mistake this comment used to describe: the read
  // asked for `text, created_at`, columns that do not exist, so PostgREST
  // refused the whole query and EVERY call review was written as though the
  // call had never happened, then told the human it was too short to review.
  // The same wrong column list broke every offer email. Reviewing a finished
  // call, it also prefers the accurate after-call transcript over Twilio's
  // realtime one.
  const { lines: rows } = await readCallTranscript(supabase as never, body.callId, { limit: 400 });
  const lines = formatTranscript(rows, Number.MAX_SAFE_INTEGER).split('\n').filter(Boolean);

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
