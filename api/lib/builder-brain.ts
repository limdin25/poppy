// The brain that holds the builder conversation, from the invite to a booked
// builder standing outside the right house at the right time.
//
// Hugo, 2026-08-22: "every time now when we have a viewing arranged, you have
// to book the builder end to end... they ask for the full address, see the
// response and if they ask for the address say we're gonna get the address and
// get back to them... run the AI now to be able to handle end to end."
//
// WHAT WAS ACTUALLY BROKEN. The invites already send themselves. What never
// happened is the reply. Three builders have been lost to silence rather than
// to a decision: Lunar Builders agreed to Oundle Road and asked in the same
// breath for the full address, went unanswered for 41 hours and cancelled on
// the morning of the viewing; on 21 August PZ Builders asked for our company
// details and Muddasir Builder said "Hi", and a day later neither had a word
// back. The generic sales AI could not have answered them either: it is off at
// the global switch, and it knows nothing about which house, which afternoon,
// or whether we hold a house number.
//
// THE DIVISION OF LABOUR, which is the only thing in this file worth arguing
// about. The model chooses WORDS. It never chooses FACTS, and it can never
// cause a fact to exist.
//
//   the model decides   what they meant, and how to phrase the answer
//   the code decides    what is true, what may be said, and what happens
//
// So `confirm` from the model books nobody by itself: assignBuilderToProperty
// re-reads the floor gate and can refuse. A reply that names a house number we
// do not hold has the number taken back out by stripInventedHouseNumber, the
// same fence that caught an invented "12 Welwyn Park Road" in an email to the
// branch selling that exact house. A reply carrying money is discarded whole,
// because a builder quotes us and we never quote a builder, and a number in
// that direction is a negotiation nobody authorised.
//
// AND THE ONE THING IT MUST NOT DO IS GUESS A DATE. The date is the only fact
// here whose invention puts a real person outside a real house on the wrong
// afternoon. A builder proposing a different day is escalated to a human, never
// agreed to.

import type { SupabaseClient } from '@supabase/supabase-js';
import { toGsm7 } from './sms-charset.js';
import { stripInventedHouseNumber } from './draft-guards.js';
import { viewingTimeLabel, builderFacingAddress, type OutreachProperty } from './builder-outreach.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Sb = SupabaseClient<any, any, any>;

/** Who we are on the phone and on WhatsApp. The registered company, because a
 *  builder asking "who are you" is asking a question with a legal answer, and
 *  the one in the property agreement is the one in Companies House. */
export const UNICO_COMPANY = {
  name: 'ULINC UNICO GROUP LTD',
  trading: 'Unico',
  number: '11197856',
  office: '483 Green Lanes, London, England, N13 4BS',
};

/** The person the builder thinks they are talking to, matching the invite. */
export const BRAIN_SENDER_NAME = 'Pedro';

/** At most this many brain replies to one builder on one house. A builder who
 *  needs a seventh answer needs a person, not a better prompt. */
export const MAX_BRAIN_REPLIES = 6;

export interface BuilderFacts {
  builderName: string;
  /** The address a builder can actually find, with the house number when we
   *  hold one. */
  address: string;
  /** TRUE only when the address carries a house number. The single most
   *  expensive fact in this file. */
  addressIsExact: boolean;
  /** "Wednesday 26 August at 2:30pm", UK wall time. */
  viewingLabel: string;
  /** Beds and property type when the listing gave them, for "what is it". */
  propertyLine: string;
  /** Anything Pedro learned on the call about condition, in his own words. */
  worksLine: string;
  /** Already booked onto this house? */
  alreadyConfirmed: boolean;
}

export type BuilderIntent =
  | 'yes'
  | 'no'
  | 'question'
  | 'reschedule'
  | 'chitchat'
  | 'unclear';

export type BuilderNeed =
  | 'full_address'
  | 'works_scope'
  | 'company_details'
  | 'contact_number'
  | 'payment'
  | 'other';

export interface BrainVerdict {
  intent: BuilderIntent;
  needs: BuilderNeed[];
  /** True only for an unambiguous yes to the slot we named. */
  confirm: boolean;
  /** The words to send. */
  reply: string;
  /** What the model could not answer from the facts it was given. Free text,
   *  used to word the question put to Hugo and Pedro. */
  missing: string | null;
}

export type BrainAction =
  | 'reply'
  | 'reply_and_confirm'
  | 'reply_and_ask_ops'
  | 'reply_and_close'
  | 'ask_ops_only'
  | 'nothing';

export interface BrainDecision {
  action: BrainAction;
  reply: string;
  intent: BuilderIntent;
  needs: BuilderNeed[];
  /** Why a human is being asked, when one is. */
  opsQuestion: string | null;
  opsKind: 'builder_needs_address' | 'builder_needs_scope' | 'builder_time_change' | null;
  /** What we will tell the builder once a human answers. */
  pendingReply: string | null;
  /** Fences that fired, for the log and the tests. */
  guards: string[];
}

// ---------------------------------------------------------------------------
// The facts
// ---------------------------------------------------------------------------

/** Does this address name a specific building, or only a street?
 *
 *  Rightmove publishes no house number on 96.6% of adverts, so "Oundle Road,
 *  Kingstanding, Birmingham B44 8EP" is the normal shape and it is NOT enough
 *  to send somebody to. A leading number ("10, Stevenson Avenue") or a named
 *  building ("Flat 2", "Rose Cottage") is. */
export function addressIsExact(address: string): boolean {
  const first = String(address ?? '').split(',')[0].trim();
  if (!first) return false;
  if (/^\d+[a-z]?\b/i.test(first)) return true;
  return /^(flat|apartment|unit|apt)\s/i.test(first);
}

export function buildFacts(
  // THE COLUMN NAMES ARE brrr_properties' OWN, not tidier synonyms. `bedrooms`
  // rather than beds, `notes` rather than condition_notes. The first live run
  // of the sweep asked for the tidier ones, got an error and no row from
  // PostgREST, and silently answered nobody.
  property: OutreachProperty & {
    bedrooms?: number | null; property_type?: string | null;
    notes?: string | null; viewing_notes?: string | null;
    assigned_builder_id?: string | null;
  },
  builderName: string,
  builderId?: string | null,
): BuilderFacts {
  const address = builderFacingAddress(property);
  const beds = Number(property.bedrooms ?? NaN);
  const type = String(property.property_type ?? '').trim();
  const bits: string[] = [];
  if (Number.isFinite(beds) && beds > 0) bits.push(`${beds} bed`);
  if (type) bits.push(type.toLowerCase());
  const works = [property.notes, property.viewing_notes]
    .map((s) => String(s ?? '').trim()).filter(Boolean).join('. ');
  return {
    builderName,
    address,
    addressIsExact: addressIsExact(address),
    viewingLabel: property.viewing_at ? viewingTimeLabel(property.viewing_at) : '',
    propertyLine: bits.join(' '),
    worksLine: works,
    alreadyConfirmed: Boolean(
      property.assigned_builder_id && builderId && property.assigned_builder_id === builderId,
    ),
  };
}

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------

export function brainSystemPrompt(facts: BuilderFacts): string {
  return [
    `You are ${BRAIN_SENDER_NAME}, texting on WhatsApp for ${UNICO_COMPANY.trading}, a UK property investment company.`,
    'We buy houses that need work, do them up, and rent or sell them. You invited this builder to come to a property and give a rough price for the refurbishment. They have replied. Write the next message.',
    '',
    'WHAT YOU KNOW. Nothing else is true, and you may not add to it:',
    `- The builder is ${facts.builderName}.`,
    `- The property is ${facts.address}${facts.propertyLine ? ` (${facts.propertyLine})` : ''}.`,
    facts.addressIsExact
      ? '- That address includes the house number, so you may give it in full.'
      : '- WE DO NOT HAVE THE HOUSE NUMBER. The advert does not publish one. If they ask for the full address, tell them you are getting the exact number now and will come straight back with it. NEVER invent a number.',
    facts.viewingLabel
      ? `- The viewing is ${facts.viewingLabel}, UK time. This is the only day and time you may agree to.`
      : '- The date has not been set yet. Do not name one.',
    facts.worksLine ? `- What we know about the work: ${facts.worksLine}` : '- We have no detail on the works yet beyond a full refurbishment.',
    `- Who we are, if asked: ${UNICO_COMPANY.trading}, registered as ${UNICO_COMPANY.name}, company number ${UNICO_COMPANY.number}, ${UNICO_COMPANY.office}.`,
    '- What we want on the day: they walk the house and give us a rough refurbishment price, ideally on the day itself.',
    '',
    'HARD RULES:',
    '1. Never invent a fact. Not a house number, not a date, not a price, not a name. If you do not know it, say you are finding out and will come back.',
    '2. Never name any sum of money, in any direction. They quote us, we do not quote them.',
    '3. Never agree to a different day or time. If they want to move it, say you will check and come back.',
    '4. Two short sentences at most. Plain, warm, like a person texting on a job. British English.',
    '5. Punctuation: no long dashes, no curly quotes, no ellipsis characters, no markdown, no emojis. Straight punctuation only.',
    '6. Never say you are an AI, and never sign off with a name in brackets.',
    '',
    'Answer with JSON only, no other text:',
    '{"intent":"yes|no|question|reschedule|chitchat|unclear","needs":["full_address"|"works_scope"|"company_details"|"contact_number"|"payment"|"other"],"confirm":true|false,"missing":null or a short description of the one fact you needed and did not have,"reply":"the message to send"}',
    '',
    '"confirm" is true ONLY when they have clearly agreed to attend at the day and time we named, with nothing left blocking it.',
    '"missing" is for a fact a human here would have to look up, like the house number or what work the property needs. Leave it null when you could answer fully.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Reading the model
// ---------------------------------------------------------------------------

const INTENTS: BuilderIntent[] = ['yes', 'no', 'question', 'reschedule', 'chitchat', 'unclear'];
const NEEDS: BuilderNeed[] = ['full_address', 'works_scope', 'company_details', 'contact_number', 'payment', 'other'];

/**
 * Read the model's answer, tolerating the wrappers models add.
 *
 * A verdict we cannot read is 'unclear' with an empty reply, which the decision
 * layer turns into "say nothing, tell a human". Silence plus a raised hand is
 * always safer than a message assembled from a half-parsed object.
 */
export function parseBrainVerdict(raw: string): BrainVerdict {
  const fallback: BrainVerdict = { intent: 'unclear', needs: [], confirm: false, reply: '', missing: null };
  const text = String(raw ?? '').trim();
  if (!text) return fallback;
  const fenced = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start < 0 || end <= start) return fallback;
  let obj: Record<string, unknown>;
  try { obj = JSON.parse(fenced.slice(start, end + 1)) as Record<string, unknown>; }
  catch { return fallback; }
  const intent = String(obj.intent ?? '').toLowerCase() as BuilderIntent;
  const needsRaw = Array.isArray(obj.needs) ? obj.needs : [];
  return {
    intent: INTENTS.includes(intent) ? intent : 'unclear',
    needs: needsRaw
      .map((n) => String(n ?? '').toLowerCase() as BuilderNeed)
      .filter((n) => NEEDS.includes(n)),
    confirm: obj.confirm === true,
    reply: String(obj.reply ?? '').trim(),
    missing: obj.missing == null || obj.missing === '' ? null : String(obj.missing).slice(0, 300),
  };
}

// ---------------------------------------------------------------------------
// The fences
// ---------------------------------------------------------------------------

/** Anything that reads as money. Deliberately wide: a false positive costs one
 *  canned holding line, a false negative puts a number in front of a builder
 *  that nobody at Unico agreed to. */
const MONEY = /(?:[£$€]\s?\d)|(?:\b\d[\d,.]*\s?(?:k|grand)\b)|(?:\b\d{1,3},\d{3}\b)|(?:\bGBP\b)/i;

/** A day name, which is how a wrong date would reach a builder. */
const WEEKDAY = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

export interface GuardResult {
  text: string;
  /** Empty means the reply cannot be sent as written and the caller must fall
   *  back to a canned line. */
  ok: boolean;
  guards: string[];
}

/**
 * Everything a model may not do to a message, undone.
 *
 * Order matters: the cheap textual repairs first, then the two refusals. A
 * refusal returns ok:false rather than a patched sentence, because a message
 * that had money or a wrong day surgically removed from it is a message whose
 * remaining sentences were written for a different meaning.
 */
export function guardBuilderReply(reply: string, facts: BuilderFacts): GuardResult {
  const guards: string[] = [];
  let text = String(reply ?? '').trim();
  if (!text) return { text: '', ok: false, guards: ['empty'] };

  // Markdown and any leaked JSON scaffolding.
  const stripped = text.replace(/[*_`#>]/g, '').replace(/\s{2,}/g, ' ').trim();
  if (stripped !== text) { guards.push('markdown'); text = stripped; }

  // The house rule, and on SMS also the cost rule.
  const plain = toGsm7(text);
  if (plain !== text) { guards.push('punctuation'); text = plain; }

  // A house number nobody gave us. The exact fence that caught "12 Welwyn Park
  // Road"; here it is load-bearing rather than tidy, because the whole reason
  // Lunar Builders cancelled was an address.
  if (!facts.addressIsExact) {
    const cleaned = stripInventedHouseNumber(text, facts.address);
    if (cleaned !== text) { guards.push('invented_house_number'); text = cleaned; }
  }

  // Money, in either direction.
  if (MONEY.test(text)) return { text: '', ok: false, guards: [...guards, 'money'] };

  // A day that is not the day. Only checked when we HAVE a day, and only for a
  // weekday name that does not appear in the booked slot: a model repeating
  // "Wednesday 26 August" back is right and must not be refused.
  const day = text.match(WEEKDAY)?.[0]?.toLowerCase();
  if (day && !facts.viewingLabel.toLowerCase().includes(day)) {
    return { text: '', ok: false, guards: [...guards, 'wrong_day'] };
  }

  // A model that signed itself off as an assistant.
  if (/\b(as an ai|i am an ai|language model)\b/i.test(text)) {
    return { text: '', ok: false, guards: [...guards, 'ai_disclosure'] };
  }

  if (text.length > 420) { guards.push('trimmed'); text = `${text.slice(0, 417).trimEnd()}...`.replace('...', '.'); }
  return { text, ok: true, guards };
}

// ---------------------------------------------------------------------------
// The canned lines
// ---------------------------------------------------------------------------
//
// Every one of these is what gets said when the model cannot be trusted with
// the sentence. They are deliberately dull. A builder waiting on an answer
// wants the answer or an honest "getting it", not personality.

export const CANNED = {
  gettingAddress:
    'Thanks for coming back to me. I am getting you the exact house number now, I will come straight back to you with it.',
  gettingDetail:
    'Good question, let me check that and come straight back to you.',
  checkingTime:
    'Thanks for letting me know. Let me check that and I will come back to you shortly.',
  confirmedExact: (facts: BuilderFacts) =>
    `Brilliant, thanks. You are booked in for ${facts.viewingLabel} at ${facts.address}. Anything changes, just message me here.`,
  confirmedNoNumber: (facts: BuilderFacts) =>
    `Brilliant, thanks. That is ${facts.viewingLabel} at ${facts.address}. I am getting you the exact house number and will send it over before the day.`,
  declined:
    'No problem at all, thanks for letting me know. I will keep you in mind for the next one.',
};

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

/**
 * Turn a verdict into what actually happens.
 *
 * PURE, and that is the point: every branch below is a rule about facts, so it
 * is testable without a model, a database or a network. The LLM contributes one
 * thing to this function, the wording, and the wording is the only thing it can
 * spoil.
 */
export function decideForBuilder(verdict: BrainVerdict, facts: BuilderFacts): BrainDecision {
  const guard = guardBuilderReply(verdict.reply, facts);
  const guards = [...guard.guards];
  const wantsAddress = verdict.needs.includes('full_address');
  const missingAddress = wantsAddress && !facts.addressIsExact;

  const base: BrainDecision = {
    action: 'reply', reply: guard.text, intent: verdict.intent, needs: verdict.needs,
    opsQuestion: null, opsKind: null, pendingReply: null, guards,
  };

  // 1. THEY WANT A DIFFERENT DAY. Never negotiated by a machine. The viewing
  //    time came from a branch and moving it means ringing the branch.
  if (verdict.intent === 'reschedule') {
    return {
      ...base,
      action: 'reply_and_ask_ops',
      reply: guard.ok ? guard.text : CANNED.checkingTime,
      opsKind: 'builder_time_change',
      opsQuestion:
        `${facts.builderName} cannot do ${facts.viewingLabel || 'the booked slot'} at ${facts.address} and wants to move it. `
        + 'Do you want to move the viewing, and to when? Reply with the day and time, or say find someone else.',
      pendingReply: null,
      guards: [...guards, 'reschedule_never_auto'],
    };
  }

  // 2. THEY ASKED FOR THE HOUSE NUMBER AND WE DO NOT HAVE IT. This is the
  //    Lunar Builders case, and it is the reason the whole file exists. Hugo's
  //    own instruction: say we are getting the address and get back to them.
  if (missingAddress) {
    return {
      ...base,
      action: 'reply_and_ask_ops',
      reply: guard.ok ? guard.text : CANNED.gettingAddress,
      opsKind: 'builder_needs_address',
      opsQuestion:
        `${facts.builderName} has agreed to look at ${facts.address}${facts.viewingLabel ? ` on ${facts.viewingLabel}` : ''} `
        + 'and needs the full address. The advert does not give a house number. What is it? '
        + 'Reply with just the number, or the full address, and I will send it to them.',
      // Filled in with the real number by the answer path.
      pendingReply: 'address',
      guards: [...guards, 'address_unknown'],
    };
  }

  // 3. A CLEAR YES. The booking happens in code; the caller re-reads the floor
  //    gate before anybody is committed to anything.
  if (verdict.confirm && verdict.intent === 'yes' && facts.viewingLabel) {
    return {
      ...base,
      action: 'reply_and_confirm',
      reply: guard.ok ? guard.text
        : (facts.addressIsExact ? CANNED.confirmedExact(facts) : CANNED.confirmedNoNumber(facts)),
    };
  }

  // 4. A NO. Recorded, thanked, and the search moves on.
  if (verdict.intent === 'no') {
    return { ...base, action: 'reply_and_close', reply: guard.ok ? guard.text : CANNED.declined };
  }

  // 5. A QUESTION THE MODEL COULD NOT ANSWER. It said so itself, which is the
  //    behaviour the prompt asks for and the behaviour we want: an honest hole
  //    beats a confident invention.
  if (verdict.missing) {
    return {
      ...base,
      action: 'reply_and_ask_ops',
      reply: guard.ok ? guard.text : CANNED.gettingDetail,
      opsKind: 'builder_needs_scope',
      opsQuestion:
        `${facts.builderName} asked about ${facts.address}${facts.viewingLabel ? ` (viewing ${facts.viewingLabel})` : ''} `
        + `and I could not answer: ${verdict.missing} Reply with the answer and I will pass it on.`,
      pendingReply: 'passthrough',
      guards: [...guards, 'model_flagged_missing'],
    };
  }

  // 6. THE MODEL PRODUCED NOTHING SENDABLE. No canned line fits an unknown
  //    question, so nobody is texted a guess: a human is asked instead.
  if (!guard.ok) {
    return {
      ...base,
      action: 'ask_ops_only',
      reply: '',
      opsKind: 'builder_needs_scope',
      opsQuestion:
        `${facts.builderName} said something I could not safely answer about ${facts.address}. `
        + 'Have a look at the thread in the inbox and reply to them, or tell me what to say.',
      pendingReply: 'passthrough',
      guards: [...guards, 'unsafe_reply'],
    };
  }

  return base;
}

// ---------------------------------------------------------------------------
// The model call
// ---------------------------------------------------------------------------

export interface ThreadTurn { direction: 'inbound' | 'outbound'; body: string }

/**
 * Ask the model, read it, and decide. The one impure step, kept to four lines
 * so the testable surface stays the two functions above it.
 *
 * llm.ts IS IMPORTED LAZILY, and that is not a style choice: it builds a
 * Supabase client at module load, so a static import would mean every test of
 * a regex in this file needs service-role credentials in the environment. The
 * comment at the top of draft-guards.ts makes the same point in the same words,
 * because a guard that is awkward to test is a guard that stops being tested.
 */
export async function runBuilderBrain(
  facts: BuilderFacts,
  thread: ThreadTurn[],
  model = 'claude-sonnet-4-6',
): Promise<{ decision: BrainDecision; verdict: BrainVerdict }> {
  const { callLLM } = await import('./llm.js');
  const messages = thread
    .filter((t) => String(t.body ?? '').trim())
    .slice(-12)
    .map((t) => ({
      role: (t.direction === 'inbound' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: t.body.trim(),
    }));
  const raw = await callLLM(model, brainSystemPrompt(facts), messages, 400);
  const verdict = parseBrainVerdict(raw);
  return { decision: decideForBuilder(verdict, facts), verdict };
}

// ---------------------------------------------------------------------------
// Answers coming back from a human
// ---------------------------------------------------------------------------

/**
 * A human answered "what is the house number".
 *
 * Their words become brrr_properties.viewing_address, which is what every
 * builder-facing path already prefers over the advert's street. Two rules:
 *
 *   - It is a SEPARATE column, never a correction to `address`. draft-guards
 *     and branch-email-match both read the street as address.split(',')[0], so
 *     a leading "10, " would turn the street name into a house number for both.
 *   - A bare number is glued onto the street we already hold, because "10" on
 *     its own is not an address and a builder cannot navigate to it.
 *
 * Returns null when the answer contains no number at all, which is how "I will
 * find out tomorrow" is prevented from becoming an address.
 */
export function addressFromAnswer(answer: string, currentAddress: string): string | null {
  const said = String(answer ?? '').trim();
  if (!said) return null;
  const street = String(currentAddress ?? '').trim();

  // They typed a whole address (it already contains the street name).
  const streetName = street.split(',')[0].trim();
  if (streetName && said.toLowerCase().includes(streetName.toLowerCase())) {
    return said.replace(/\s+/g, ' ').slice(0, 300);
  }
  // They typed just the number, which is the normal answer to "what is it".
  const num = said.match(/\b(\d+[a-z]?)\b/i)?.[1];
  if (!num) return null;
  return street ? `${num}, ${street}` : null;
}

/** The message that goes to the waiting builder once we have the number. */
export function addressReply(fullAddress: string, viewingLabel: string): string {
  return toGsm7(
    `Sorry for the wait, I have the full address now: ${fullAddress}.`
    + (viewingLabel ? ` See you ${viewingLabel}.` : ''),
  );
}

/**
 * A human answered a free-text question, so their words go to the builder.
 *
 * PASSED THROUGH, NOT REWRITTEN. A model paraphrasing Hugo's answer is a model
 * given one more chance to change a fact, and the whole point of asking a human
 * was that the machine did not know. Only the punctuation is normalised.
 */
export function passthroughReply(answer: string): string {
  return toGsm7(String(answer ?? '').trim()).slice(0, 600);
}
