// Draft the email to the estate agent for ONE house, from what we know about it.
//
// TWO KINDS since 2026-08-14, and the difference is the two-call process:
//   kind: 'video_request'  call one, minutes after the phone call, while the
//                          branch is still at the desk. NO figure of ours, ever.
//                          It exists so they have our address to send the video
//                          back to, and so we have theirs.
//   kind: 'offer'          call two, after the homework. The default, so every
//                          existing caller is unchanged.
//
// Hugo 2026-08-12: "the email has to be crafted every single call that we have
// a ballpark. We have to check the listing and see what is available and what
// was said on the call, and then the email gets drafted."
//
// So this is not a template with the address swapped in. It reads three
// things and writes from them:
//
//   1. the house      — address, asking price, the works, the GDV, the offer
//   2. the call       — what the estate agent actually said, off the live
//                       transcript of the call that just happened
//   3. the process    — the wording the deal process already settled on:
//                       subject to our builder, never subject to survey
//
// The model writes ENGLISH ONLY. Every figure it is allowed to use is passed in
// and it is told, hard, never to invent one. That is the same boundary the
// property brain works to: a model may argue about words, never about money.
//
// The draft lands in the send box for a human to read and edit. Nothing is sent
// from here.

import { createClient } from '@supabase/supabase-js';
import { callLLM } from '../lib/llm.js';

export const config = { runtime: 'edge' };

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const MODEL = 'claude-sonnet-5';

interface Body {
  /** wk_calls.id of the call this offer follows, when there is one. */
  callId?: string | null;
  /** Everything the strip already has on screen. Figures only, no prose. */
  house?: {
    address?: string | null;
    askingPrice?: number | null;
    offerPrice?: number | null;
    gdv?: number | null;
    refurb?: number | null;
    beds?: number | null;
    propertyType?: string | null;
    reasonLine?: string | null;
    strategy?: string | null;
  };
  /** Who we are writing to and who from. */
  agentName?: string | null;
  agencyName?: string | null;
  fromName?: string | null;
  companyName?: string | null;
  /** WHICH email. Two now, and the difference is the whole two-call process:
   *
   *   'video_request'  call one. NO figure of ours, ever. It exists so the
   *                    branch has our address and we have theirs, and it asks
   *                    for the video the builder prices the refurb from.
   *   'offer'          call two, after the homework. The default, so the
   *                    existing caller is byte-identical.
   *
   *  Hugo 2026-08-14: "on this email we can just ask for the video ... so they
   *  have our address and we have theirs." Sent while the agent is still on the
   *  phone, which is why it has to be one press. */
  kind?: 'offer' | 'video_request';
}

const SYSTEM_OFFER = [
  'You write one email: a cash buyer putting an offer to an estate agent on a house in England.',
  '',
  'HARD RULES.',
  '1. NEVER invent a number. Every figure you may use is given to you. If a figure is missing, leave the line out rather than guessing.',
  '2. The offer is "subject to our builder going round to view it and price the works". NEVER write "subject to survey" and never write "subject to contract" as the condition.',
  '3. Say what we are: a limited company buying with cash, no mortgage, no chain, 4 to 6 weeks to completion.',
  '4. Explain how we work in one short paragraph: we buy across the country, we assess remotely first, and we send a local builder to view and price the refurb in the same visit. That is why the offer is subject to the builder rather than a survey.',
  '5. Use what the estate agent actually said on the call. Refer to it plainly, the way a person would. If the transcript is empty, do not pretend a call happened.',
  '6. British English. Plain, warm, direct, no salesmanship, no flattery, no exclamation marks.',
  '7. NEVER use a long dash. No em dash, no en dash, anywhere. Use a comma or a full stop. No curly quotes, no ellipsis character.',
  '8. Do not apologise for the offer and do not justify it at length. One or two sentences on why the number is where it is, based on condition and the cost of the works.',
  '',
  'FORMAT. Return exactly this and nothing else:',
  'SUBJECT: <one line>',
  '<blank line>',
  '<the email body, ending with the sign off>',
].join('\n');

// Call one's email. It carries NO number of ours: on a discovery call we have
// not done the homework yet, and a figure in writing before the builder has
// seen anything is the exact mistake the two-call process was built to stop.
const SYSTEM_VIDEO = [
  'You write one short email: a cash buyer following up a phone call with an estate agent in England, minutes after the call, while they are often still at the desk.',
  '',
  'WHAT IT IS FOR. Two things, and nothing else: they now have our email address so they can send things back, and we are asking for a video walkthrough of the property.',
  '',
  'HARD RULES.',
  '1. NEVER put a price, an offer, a figure or a range in this email. Not ours, not theirs, not the asking price. If you are tempted, leave it out.',
  '2. NEVER invent a fact. Everything you may use is given to you. If the transcript is empty, do not pretend a conversation happened.',
  '3. Ask for a video walkthrough in plain words, and say why: our builder prices the works off it, so nobody has to travel. Offer the easy version, a phone walk round while they are next there, and say they do not need to be in it.',
  '4. If the floor plan or the full EPC came up as missing on the call, ask for those in the same breath. Never invent that they are missing.',
  '5. Say who we are in one line: a cash buyer, a limited company, no mortgage and no chain. Nothing else about us.',
  '6. SHORT. Under 150 words. This is an admin email that has to be readable on a phone in ten seconds, not a pitch.',
  '7. British English. Warm, plain, no salesmanship, no flattery, no exclamation marks.',
  '8. NEVER use a long dash. No em dash, no en dash, anywhere. Use a comma or a full stop. No curly quotes, no ellipsis character.',
  '',
  'FORMAT. Return exactly this and nothing else:',
  'SUBJECT: <one line, name the street>',
  '<blank line>',
  '<the email body, ending with the sign off>',
].join('\n');

const gbp = (n?: number | null) =>
  typeof n === 'number' && n > 0 ? `£${Math.round(n).toLocaleString('en-GB')}` : null;

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

  const h = body.house ?? {};

  // What the estate agent actually said. Newest call, oldest line first, capped
  // so a long call cannot blow the context or the bill.
  //
  // THE COLUMNS ARE body AND ts. This read used to ask for `text, created_at`,
  // which do not exist on wk_live_transcripts, so PostgREST 400d, the catch
  // swallowed it, and EVERY offer email since this endpoint shipped was written
  // as though the call had never happened. Found 2026-08-14 while wiring the
  // call-one email, which is built from the same read. An error is logged now
  // rather than silently becoming "no transcript".
  let transcript = '';
  if (body.callId) {
    try {
      const { data, error } = await supabase
        .from('wk_live_transcripts')
        .select('speaker, body, ts')
        .eq('call_id', body.callId)
        .order('ts', { ascending: true })
        .limit(200);
      if (error) console.warn('[draft-email] transcript read failed', error.message);
      transcript = (data ?? [])
        .map((r: { speaker?: string | null; body?: string | null }) =>
          `${(r.speaker ?? 'other').toUpperCase()}: ${(r.body ?? '').trim()}`)
        .filter((l) => l.length > 8)
        .join('\n')
        .slice(0, 12_000);
    } catch (e) {
      // A missing transcript is a normal case, not an error: the email still
      // writes. A BROKEN READ is not, so it is at least visible in the logs.
      console.warn('[draft-email] transcript read crashed', String(e));
    }
  }

  const facts = [
    ['Address', h.address],
    ['Asking price', gbp(h.askingPrice)],
    ['OUR OFFER, use this figure and no other', gbp(h.offerPrice)],
    ['What it is worth done up (never put this in the email)', gbp(h.gdv)],
    ['Our refurb budget (never put this in the email)', gbp(h.refurb)],
    ['Bedrooms', h.beds ? String(h.beds) : null],
    ['Type', h.propertyType],
    ['What the works look like', h.reasonLine],
    ['Estate agent name', body.agentName],
    ['Agency', body.agencyName],
    ['From', body.fromName],
    ['Buying company', body.companyName],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');

  // Call one's email never sees a figure at all. Telling a model "here is the
  // offer, do not mention it" is a rule it can break; not giving it the number
  // is a rule it cannot.
  const videoFacts = [
    ['Address', h.address],
    ['Bedrooms', h.beds ? String(h.beds) : null],
    ['Type', h.propertyType],
    ['Estate agent name', body.agentName],
    ['Agency', body.agencyName],
    ['From', body.fromName],
    ['Buying company', body.companyName],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');

  // Call one's email carries no figure at all, so it has nothing to refuse on.
  // The offer email without an offer is the thing that must never send.
  const isVideoRequest = body.kind === 'video_request';
  if (!isVideoRequest && !gbp(h.offerPrice)) {
    return new Response(
      JSON.stringify({ error: 'No offer figure on this property, so there is nothing to offer.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const user = [
    isVideoRequest ? 'THE HOUSE (facts only, and NO price of any kind goes in this email):' : 'THE HOUSE AND THE NUMBERS:',
    isVideoRequest ? videoFacts : facts,
    '',
    transcript
      ? `WHAT WAS SAID ON THE CALL (use the useful parts, ignore the rest):\n${transcript}`
      : 'THERE IS NO TRANSCRIPT for this one. Write the email without referring to a conversation.',
  ].join('\n');

  const out = await callLLM(
    MODEL,
    isVideoRequest ? SYSTEM_VIDEO : SYSTEM_OFFER,
    [{ role: 'user', content: user }],
    isVideoRequest ? 700 : 1200,
  );
  if (!out) {
    return new Response(JSON.stringify({ error: 'The model did not answer. Try again.' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // SUBJECT: on the first line, the email under it.
  const m = out.match(/^\s*SUBJECT:\s*(.+?)\s*\n([\s\S]+)$/);
  const subject = m
    ? m[1].trim()
    : isVideoRequest
      ? `${h.address ?? 'The property'}, the bits I mentioned`
      : `Offer for ${h.address ?? 'the property'}`;
  const emailBody = (m ? m[2] : out).trim();

  // Belt and braces on Hugo's punctuation rule: the model is told, and the
  // output is cleaned anyway, because one long dash in an email is forever.
  const clean = (s: string) =>
    s.replace(/[–—]/g, ',').replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"').replace(/…/g, '...');

  // THE CALL-ONE GUARD. The model is not given a figure and is told not to
  // write one, and this is the third fence: if a price appears anyway, the
  // draft is refused and the caller falls back to the fixed template. A number
  // in writing before the homework is exactly what the two-call process exists
  // to prevent, and an email cannot be unsent.
  if (isVideoRequest && /£\s*\d|\b\d{2,3},\d{3}\b|\bpounds?\b/i.test(`${subject} ${emailBody}`)) {
    return new Response(
      JSON.stringify({ error: 'The draft put a figure in a call-one email, so it was thrown away. Send the template instead.' }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    );
  }

  return new Response(
    JSON.stringify({ subject: clean(subject), body: clean(emailBody), usedTranscript: !!transcript }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}
