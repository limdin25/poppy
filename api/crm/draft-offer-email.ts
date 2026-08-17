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
import { stripInventedHouseNumber, fixGreeting, redactFigures } from '../lib/draft-guards.js';
import { decideCounter, respectsCeiling } from '../lib/counter-position.js';
import { externalDoNow } from '../lib/next-step-brief.js';

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
    /** The engine's absolute maximum, deal.offer.max. Required for a
     *  counter_reply: without it there is no way to know a figure is safe. */
    ceiling?: number | null;
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
  /** THE PERSON THIS EMAIL IS ADDRESSED TO, and the address it goes to.
   *  A draft bound for the branch opened "Hi Pedro" on 17 Aug because the
   *  pinned note mentioned Pedro; the recipient is a fact the caller knows and
   *  must pass, never something to infer from an internal instruction.
   *  fixGreeting() takes the greeting back if the model ignores it. */
  recipientName?: string | null;
  recipientEmail?: string | null;
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
  kind?: 'offer' | 'video_request' | 'address_only' | 'follow_up' | 'counter_reply';
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
    /** THE BRANCH'S OWN FIGURE, for kind 'counter_reply'. Never ours, and
     *  never acted on directly: `decideCounter` decides what we do about it. */
    theirFigure?: number | null;
    /** gold / strong / good / fair / last_resort. Below gold or strong we do
     *  not negotiate at all, whatever they have offered. */
    evidenceTier?: string | null;
    /** What we last put to them. */
    currentOffer?: number | null;
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
  '3a. YOU ARE WRITING TO THE ESTATE AGENT NAMED AS THE RECIPIENT, nobody else. Address them and only them. The blocker text and the internal notes may mention our own people by name ("send it to Pedro to forward to Lucy"); those are instructions to US, never the person you are writing to, and their names must never appear in the greeting. If you are given no recipient name, open with "Hello,".',
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


// THE REPLY WHEN THEY COME BACK ON PRICE.
//
// Hugo, 2026-08-14: "AI should draft the email reply based on the course and
// based on comparable and likely cost of fixing and then decide if we can
// increase the offer or just pass."
//
// The DECIDING is not done here. api/lib/counter-position.ts works out raise,
// hold or pass and the exact figure, in code, and this prompt is handed the
// answer and told to write it. A model asked "should we go up?" finds a reason
// to say yes, because that is where the conversation pulls, and a number said
// out loud on a property deal cannot be unsaid.
//
// This is the ONLY kind allowed to talk about price after an offer has gone
// out. `follow_up` is explicitly forbidden from re-opening it (rule 3 there),
// which is why it could not answer Lexi.
const SYSTEM_COUNTER = [
  'You write one email: a cash buyer replying to an estate agent who has come back on price.',
  '',
  'THE DECISION HAS ALREADY BEEN MADE and you are told what it is. You are writing it, not reaching it. Never argue with it, never soften it into a maybe, and never hint that a different number might be possible.',
  '',
  'HARD RULES.',
  '1. NEVER name a figure other than the ones you are given. No arithmetic, no splitting the difference, no "around" a number, no hinting at a range.',
  '2. If the decision is HOLD or PASS you may not put ANY offer figure in the email. Say plainly that we cannot improve it and why, in our own words.',
  '3. If the decision is RAISE, name the new figure once, exactly as given, and say it is subject to our builder going round to view and price the works. NEVER "subject to survey".',
  '4. When the new figure is our maximum, say so plainly and without apology, so their next answer is a yes or a no rather than another round.',
  '5. Never blame the vendor, never lecture them about the market, and never explain our margin. One or two sentences on WHY the number is where it is, based on condition and the cost of the works.',
  '6. Thank them for coming back to us. They did us a favour by answering.',
  '7. Leave the door open on a hold or a pass: if the position changes, we would still be interested.',
  '8. SHORT. Under 180 words.',
  '9. British English. Plain, warm, direct, no salesmanship, no flattery, no exclamation marks.',
  '10. NEVER use a long dash. No em dash, no en dash, anywhere. Use a comma or a full stop. No curly quotes, no ellipsis character.',
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

  // THE SAME DOOR AS EVERY OTHER DEAL ROUTE. This had no auth check of any
  // kind, and it is not a harmless drafting endpoint: given a callId it reads
  // `wk_live_transcripts` with the service-role key and echoes the call into
  // its reply, and it reads `platform_settings.proof_of_funds`, which is the
  // company name, the bank and a dated balance. Anyone who knew the URL could
  // read both, and run up the model bill doing it.
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  const { data: userResp } = await supabase.auth.getUser(jwt);
  if (!userResp?.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  const caller = createClient(
    process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: allowed } = await caller.rpc('wk_is_agent_or_admin');
  if (!allowed) {
    return new Response(JSON.stringify({ error: 'CRM access required' }), { status: 403 });
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
  const isCounterReply = body.kind === 'counter_reply';
  // The follow-up is the one kind that does not need a figure: a branch waiting
  // on proof of funds is emailed about the proof of funds, not about money.
  if (!isVideoRequest && !isFollowUp && !isCounterReply && !gbp(h.offerPrice)) {
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
    // The blocker is the whole point of the email, so it is shown in full, but
    // its figures go the same way the note's do: a blocker that reads "the
    // agent will not put GBP 103,600 forward without proof of funds" is a
    // blocker whether or not the model can see the number.
    blockers.length
      ? `WHAT IS HOLDING IT UP (this is what the email is FOR, answer it first):\n${blockers.map((b) => `- ${redactFigures(b)}`).join('\n')}`
      : 'Nothing specific is recorded as holding it up. Write a short, friendly chase asking where it stands.',
    // OUR OWN FIGURES ARE STRIPPED OUT BEFORE THE MODEL SEES THEM.
    //
    // `do_now` is written for Pedro and Hugo, and two of its lines state our
    // money: "Today's band opens at X and stops at Y", and "Climb one rung at a
    // time: A, B, C" whose last rung IS the walk-away. The next line of that
    // same array reads "Never say the ceiling out loud" and the whole lot was
    // being handed to a model told to "say the parts that concern THEM".
    //
    // Forbidding a model to mention a number while showing it the number is a
    // hope, not a fence. This is the fence, and it lives here rather than at
    // the caller so no future caller can skip it.
    externalDoNow(c.doNow).filter(Boolean).length
      ? `WHAT WE HAVE ALREADY DECIDED TO DO (say only the parts that concern THEM):\n${externalDoNow(c.doNow).map((d) => `- ${d}`).join('\n')}`
      : null,
    // SAME FENCE FOR THE PINNED NOTE. It was handed over verbatim under the
    // label "never quote it", which is the hope the comment above warns about:
    // the model duly quoted a figure out of it into a proof-of-funds email.
    c.pinnedNote ? `OUR OWN NOTE on this deal (internal, never quote it):\n${redactFigures(c.pinnedNote)}` : null,
    proofFacts || null,
  ].filter(Boolean).join('\n\n');


  // WHAT WE DO ABOUT THEIR FIGURE, decided in code before a word is written.
  // The model is handed the answer; it cannot reach a different one because
  // the only figures it is given are the ones this allows.
  const counter = isCounterReply
    ? decideCounter({
        ceiling: h.ceiling ?? null,
        currentOffer: c.currentOffer ?? h.offerPrice ?? null,
        theirFigure: c.theirFigure ?? null,
        evidenceTier: c.evidenceTier ?? null,
      })
    : null;

  // THE FENCE. A decision that would have us pay more than the maximum is a
  // bug, and an email is the one thing that cannot be unsent.
  if (counter && !respectsCeiling(counter, h.ceiling ?? null)) {
    return new Response(
      JSON.stringify({ error: 'The reply would have gone above our maximum, so it was refused.' }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const counterFacts = counter ? [
    `Address: ${h.address ?? 'the property'}`,
    `THE DECISION, already made, write it and do not argue with it: ${counter.position.toUpperCase()}`,
    `Why: ${counter.reason}`,
    counter.newOffer != null
      ? `THE ONLY FIGURE YOU MAY NAME: ${gbp(counter.newOffer)}`
      : 'YOU MAY NOT PUT ANY OFFER FIGURE IN THIS EMAIL AT ALL.',
    counter.code === 'raise_to_ceiling_final'
      ? 'Say plainly that this is our maximum.' : null,
    c.theirFigure ? `What they asked for (do NOT agree to it unless it IS the figure above): ${gbp(c.theirFigure)}` : null,
    h.reasonLine ? `What the works look like: ${h.reasonLine}` : null,
    body.agentName ? `Estate agent name: ${body.agentName}` : null,
    body.fromName ? `From: ${body.fromName}` : null,
    body.companyName ? `Buying company: ${body.companyName}` : null,
  ].filter(Boolean).join('\n') : '';

  // WHO IT IS ADDRESSED TO, in the facts and not only in the rules, because a
  // rule about a name is useless without the name. Missing it is why a draft
  // that had been told "address the recipient" still opened "Hello," (17 Aug).
  const recipientLine = body.recipientName
    ? `THE PERSON YOU ARE WRITING TO (greet them by this name and nobody else): ${body.recipientName}`
    : 'You have no recipient name, so open with "Hello,".';

  const user = isCounterReply ? [
    'THEY HAVE COME BACK ON PRICE. Here is what was decided and everything you may say:',
    recipientLine,
    counterFacts,
    '',
    transcript
      ? `WHAT WAS SAID ON THE LAST CALL (use the useful parts):\n${transcript}`
      : 'There is no transcript for this one.',
  ].join('\n') : [
    isVideoRequest ? 'THE HOUSE (facts only, and NO price of any kind goes in this email):' : 'THE HOUSE AND THE NUMBERS:',
    isVideoRequest ? videoFacts : facts,
    recipientLine,
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
        : isCounterReply ? SYSTEM_COUNTER
          : isFollowUp ? SYSTEM_FOLLOW_UP
            : SYSTEM_OFFER,
    [{ role: 'user', content: user }],
    isAddressOnly ? 400 : isVideoRequest ? 700 : isCounterReply ? 700 : isFollowUp ? 800 : 1200,
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
  // The greeting is fixed on the BODY only: a subject line never says hello.
  const finishBody = (s: string) => fixGreeting(finish(s), body.recipientName);

  return new Response(
    JSON.stringify({
      subject: finish(subject),
      body: finishBody(emailBody),
      usedTranscript: !!transcript,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}
