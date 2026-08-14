// Draft the email to the estate agent for ONE house, from what we know about it.
//
// TWO KINDS since 2026-08-14, and the difference is the two-call process:
//   kind: 'video_request'  call one, minutes after the phone call, while the
//                          branch is still at the desk. NO figure of ours, ever.
//                          It exists so they have our address to send the video
//                          back to, and so we have theirs.
//   kind: 'address_only'   the same call, when the branch has just said no to
//                          the video. Two lines, asks for NOTHING, and its only
//                          job is to make the address real while they are still
//                          on the phone. A branch that has refused one thing
//                          will refuse a second ask in the same breath.
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
import { stripInventedHouseNumber } from '../lib/draft-guards.js';

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
  kind?: 'offer' | 'video_request' | 'address_only' | 'follow_up';
  /** THE DEAL AS IT STANDS, for kind 'follow_up'.
   *
   *  Hugo, 2026-08-14: "when we have to email the prospects I want the AI to
   *  draft it, I don't want a static template. The prospect that's expecting
   *  the proof of funds, the email should be there ready to go."
   *
   *  There is no live call behind a board card, so the transcript is empty and
   *  the model would otherwise be writing from an address and nothing else.
   *  This is what it writes from instead: the next-step brief, in the brain's
   *  own words. Every figure in it was READ from the deal engine when the brief
   *  was written, so passing it through is not a second opinion about money. */
  context?: {
    /** What has to happen next, the brief's do_now lines. */
    doNow?: string[] | null;
    /** What is in the way. "The branch wants proof of funds" lives here. */
    blockers?: string[] | null;
    /** Hugo's own pinned note on the house, when he wrote one. */
    pinnedNote?: string | null;
    /** The deal-process step the branch is on. */
    step?: string | null;
  };
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

// The email for a branch that said no to the video. It asks for nothing at all.
// Hugo, 2026-08-14: "the email is gonna be just written hi, this is Pedro,
// please confirm you have seen this email."
const SYSTEM_ADDRESS_ONLY = [
  'You write one very short email: a cash buyer following up a phone call with an estate agent in England, seconds after the call, while they are still at the desk.',
  '',
  'WHAT IT IS FOR. One thing only: they now have our email address, and they are asked to confirm it reached them. The agent has JUST declined to send a video, so this email asks for NOTHING.',
  '',
  'HARD RULES.',
  '1. NEVER put a price, an offer, a figure or a range in this email. Not ours, not theirs, not the asking price.',
  '2. ASK FOR NOTHING except a one line reply confirming it arrived. No video, no floor plan, no EPC, no viewing, no documents. They have just said no to one thing and this email must not read as a second ask.',
  '3. Say who is writing, the company, and the property that was just discussed. Say the director may come back to them directly with a couple of questions.',
  '4. VERY SHORT. Under 70 words. Four sentences at the most.',
  '5. British English. Warm, plain, ordinary. No salesmanship, no flattery, no exclamation marks, no thanking them three times.',
  '6. NEVER use a long dash. No em dash, no en dash, anywhere. Use a comma or a full stop. No curly quotes, no ellipsis character.',
  '',
  'FORMAT. Return exactly this and nothing else:',
  'SUBJECT: <one line, name the street>',
  '<blank line>',
  '<the email body, ending with the sign off>',
].join('\n');

// The email Hugo sends from the BOARD, days after the call, when the deal is
// waiting on one specific thing. Hugo, 2026-08-14: "the prospect that's
// expecting the approval of funds, the template should be there ready to go."
//
// It is the only kind written from the BRIEF rather than from a transcript,
// because by the time a card sits in Nurturing the call is long over and what
// matters is the one thing standing in the way.
//
// It may name our offer, because the branch already has it: this email exists
// on a deal that has been discussed. It may NOT invent a new number, move the
// one we gave, or promise anything the brief does not say we have.
const SYSTEM_FOLLOW_UP = [
  'You write one email: a cash buyer chasing an estate agent in England on a house they have already discussed by phone.',
  '',
  'WHAT IT IS FOR. There is exactly ONE thing holding this deal up. You are told what it is. The whole email exists to move that one thing, and nothing else.',
  '',
  'HARD RULES.',
  '1. NEVER invent a number. Every figure you may use is given to you. If the blocker does not need a figure, do not put one in at all.',
  '2. NEVER promise something we have not got, and never quote a balance, a company, a bank or a date that is not in the facts below. If a proof of funds is attached you say so and explain it. If one is NOT attached, say only that it is being sent and when.',
  '3. NEVER re-open the price. If our offer is mentioned it is only to remind them what is on the table, in the words we already used.',
  '4. Answer the blocker in the FIRST two sentences. An estate agent reads one paragraph.',
  '4a. Write the address EXACTLY as you are given it. NEVER add a house number, a flat number or a postcode that is not there. Most listings do not publish a house number and a wrong one goes to the branch selling that exact house.',
  '4b. IF a proof of funds is attached to this email, and only then, EXPLAIN IT in its own short paragraph, using the facts you are given and no others. Cover, in this order and in plain sentences: that the money is held under OUR OWN company, named, and that the statement is a certified copy from its bank on the date given; that it sits across several company accounts, which is why there is more than one balance on it; the total available; that the account numbers, sort codes and IBANs are hidden for security, which is normal on a document sent by email and does not affect what it proves; and how the purchase completes. An agent who does not understand the document will not pass it to the vendor.',
  '4c. The company on the statement will NOT be the trading name they know us by from the phone call. Write it as OURS, "our company X" or "held under our company X", so it plainly belongs to us. NEVER write it in a way that could read as a third party, a client, an investor or somebody else\'s money.',
  '5. Ask ONE clear question at the end, the one that moves it on, and make it easy to answer in a line.',
  '6. Never write "subject to survey". Our condition is always "subject to our builder going round to view it and price the works".',
  '7. SHORT. Under 160 words, or under 220 when a proof of funds has to be explained.',
  '8. British English. Plain, warm, direct, no salesmanship, no flattery, no exclamation marks, no chasing tone.',
  '9. NEVER use a long dash. No em dash, no en dash, anywhere. Use a comma or a full stop. No curly quotes, no ellipsis character.',
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
  const isAddressOnly = body.kind === 'address_only';
  const isVideoRequest = body.kind === 'video_request' || isAddressOnly;
  const isFollowUp = body.kind === 'follow_up';
  // The follow-up is the one kind that does not need a figure: a branch waiting
  // on proof of funds is emailed about the proof of funds, not about money.
  if (!isVideoRequest && !isFollowUp && !gbp(h.offerPrice)) {
    return new Response(
      JSON.stringify({ error: 'No offer figure on this property, so there is nothing to offer.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // WHERE THE DEAL STANDS, for the follow-up. The brief is the whole input:
  // the blocker is the reason the email is being written at all, and the
  // do_now lines are what we have already decided to do about it.
  const c = body.context ?? {};
  const blockers = (c.blockers ?? []).filter(Boolean);

  // THE DOCUMENT GOING WITH THIS EMAIL, described in its own words.
  //
  // Hugo, 2026-08-14: "with the statement we say that we will be using a bridge
  // loan, all good. Hide sort codes and IBANs to stop fraud. Make sure all
  // explained on the email draft by our brain."
  //
  // An estate agent who cannot make sense of the attachment will not pass it to
  // the vendor, and this one needs explaining: the balances sit across ten
  // company accounts, the account numbers are blanked, and the company on it is
  // not the company Pedro said on the phone. So the facts are READ from the
  // same platform_settings row the attachment itself comes from. They are never
  // written here: replacing the statement updates the wording with it, and a
  // model that is given a total cannot invent one.
  let proofFacts = '';
  if (isFollowUp && /proof of fund|pof\b|evidence of fund/i.test(
    [...blockers, ...(c.doNow ?? []), c.pinnedNote ?? ''].join(' '),
  )) {
    try {
      const { data: pofRow } = await supabase
        .from('platform_settings')
        .select('value')
        .eq('key', 'proof_of_funds')
        .maybeSingle();
      const p = JSON.parse(String(pofRow?.value ?? '{}')) as Record<string, unknown>;
      if (p.path) {
        const total = Number(p.total_gbp);
        proofFacts = [
          'THE PROOF OF FUNDS IS ATTACHED TO THIS EMAIL. Explain it, using ONLY these facts:',
          `- The document: a certified copy of the ${String(p.bank ?? 'bank')} balance sheets, dated ${String(p.dated ?? '')}`,
          // "OUR company", never a bare name. Hugo, 2026-08-14: "you can say
          // under our company." The entity on the statement is not the trading
          // name Pedro gave on the phone, so a second company appearing with no
          // relationship attached reads to an agent like somebody else's money,
          // which is exactly the doubt this document exists to remove.
          //
          // The name itself is never written in this file, only referred to.
          // tests/property-call-email.test.ts fails the build if any company,
          // bank or total is hardcoded here rather than read from the settings
          // row, because a stale statement must never leave stale wording.
          `- The company holding the funds, which is OUR OWN company and must be written as ours ("our company ${String(p.company ?? '')}"), never as a third party: ${String(p.company ?? '')}`,
          p.accounts ? `- It shows ${String(p.accounts)} company accounts, which is why there is more than one balance on it` : null,
          Number.isFinite(total) && total > 0
            ? `- Total available across those accounts: ${gbp(total)}`
            : null,
          p.redacted
            ? '- The account numbers, sort codes and IBANs are hidden for security. Say so plainly and say it is normal for a document sent by email, and that it does not affect what the statement proves.'
            : null,
          p.funding_note ? `- How the purchase completes: ${String(p.funding_note)}` : null,
        ].filter(Boolean).join('\n');
      }
    } catch {
      // No pointer, or unreadable. The email still writes, it just does not
      // describe an attachment, which is the honest outcome.
    }
  }
  const dealState = [
    c.step ? `The step this branch is on: ${c.step}` : null,
    blockers.length
      ? `WHAT IS HOLDING IT UP (this is what the email is FOR, answer it first):\n${blockers.map((b) => `- ${b}`).join('\n')}`
      : 'Nothing specific is recorded as holding it up. Write a short, friendly chase asking where it stands.',
    (c.doNow ?? []).filter(Boolean).length
      ? `WHAT WE HAVE ALREADY DECIDED TO DO (say only the parts that concern THEM):\n${(c.doNow ?? []).map((d) => `- ${d}`).join('\n')}`
      : null,
    c.pinnedNote ? `OUR OWN NOTE on this deal (internal, never quote it):\n${c.pinnedNote}` : null,
    proofFacts || null,
  ].filter(Boolean).join('\n\n');

  const user = [
    isVideoRequest ? 'THE HOUSE (facts only, and NO price of any kind goes in this email):' : 'THE HOUSE AND THE NUMBERS:',
    isVideoRequest ? videoFacts : facts,
    '',
    isFollowUp
      ? dealState
      : transcript
        ? `WHAT WAS SAID ON THE CALL (use the useful parts, ignore the rest):\n${transcript}`
        : 'THERE IS NO TRANSCRIPT for this one. Write the email without referring to a conversation.',
  ].join('\n');

  const out = await callLLM(
    MODEL,
    isAddressOnly ? SYSTEM_ADDRESS_ONLY
      : isVideoRequest ? SYSTEM_VIDEO
        : isFollowUp ? SYSTEM_FOLLOW_UP
          : SYSTEM_OFFER,
    [{ role: 'user', content: user }],
    isAddressOnly ? 400 : isVideoRequest ? 700 : isFollowUp ? 800 : 1200,
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
      : isFollowUp
        ? `${h.address ?? 'The property'}, where we are`
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

  const finish = (s: string) => stripInventedHouseNumber(clean(s), h.address);

  return new Response(
    JSON.stringify({
      subject: finish(subject),
      body: finish(emailBody),
      usedTranscript: !!transcript,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}
