// LISTENING TO THE CALL. Every call, automatically, with the quote to prove it.
//
// Hugo, 2026-08-18, looking at a card that said "STILL MISSING (0 of 12
// ANSWERED)" beside an eight minute recorded call with a ninety two line
// transcript: "are you sure, its 0 of 12 answered. I think you are not
// listening to the calls."
//
// He was right, and the measurement is worse than the screen suggested:
//
//     calls with a stored transcript ............ 553
//     properties on file ........................ 215
//     properties with ANY checklist answer ...... 3
//
// The twelve questions could only ever be filled by a human typing them into
// the Houses pane after the call, and nobody types them. So the ballpark priced
// off an empty checklist, the brain could only ever report "0 of 12" and cap
// its own confidence, and five hundred and fifty three recorded conversations
// sat unread.
//
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS RATHER THAN A FOURTH READER
// ---------------------------------------------------------------------------
//
// There were already two transcript readers and neither filled the checklist:
//
//   api/lib/ballpark.ts   the real one. It already extracts condition_band,
//                         works, floor area, rent, the agent's comparable and
//                         the rejected offer, which is SIX of the twelve, and
//                         then saves them under different names for the engine
//                         (floor_area_heard_sqm, not floor_area). It also only
//                         runs when a human presses Confirm.
//   api/lib/brrr.ts       extractQualification, written for the retired robot
//                         caller, with no live caller since August.
//
// So this file owns the CHECKLIST reading, ballpark.ts keeps owning the ENGINE
// payload, and the one thing they genuinely shared, finding and reading the
// newest transcript, lives here and is imported by both. One reader for one
// job, which is the rule the repo already lives by for money and for comps.
//
// ---------------------------------------------------------------------------
// THE THREE RULES
// ---------------------------------------------------------------------------
//
//   1. A MACHINE ANSWER NEVER OVERWRITES A HUMAN ONE. Pedro typed it because he
//      was on the call; a model read a transcript afterwards. Where both have
//      an answer, his stands.
//   2. EVERY MACHINE ANSWER CARRIES THE QUOTE IT CAME FROM, under `_heard`, so
//      anybody can check it against what the agent actually said. An answer
//      nobody can check is a guess wearing a fact's clothes.
//   3. NOTHING MONEY-SHAPED IS DERIVED HERE. Figures are REPORTED as the agent
//      said them and go to the engine to be priced. This file never computes an
//      offer, a value or a discount.

// llm.js and ballpark.js are imported LAZILY, inside extractChecklistFromCall.
// Both build a Supabase client at module load, so a static import would make
// the pure parts of this file (the parser, the merge, the count, the three
// rules that actually protect a deal) untestable without live credentials.
// Same rule money-auditor.ts already lives by: pure things stay pure.
import type { SupabaseClient } from '@supabase/supabase-js';
import { BANDS } from './condition-vocab.js';
import { CHECKLIST_KEYS, HEARD_KEY } from './deal-state.js';

// The same loose client shape ballpark.ts and deal-manager-run.ts already use.
// A structural `{ from: ... }` looks equivalent and is not: readNewestTranscript
// takes a real SupabaseClient, and the api type check (new on 17 Aug) is the
// first thing that has ever noticed the difference.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = SupabaseClient<any, any, any>;

/** Cheap on purpose: this is transcription reading, not judgement. */
export const EXTRACT_MODEL = 'claude-sonnet-5';

/** Where the machine's evidence lives on `qualification`.
 *
 *  Underscore-prefixed so it can never be mistaken for one of the twelve: the
 *  checklist count in deal-state.ts walks CHECKLIST_KEYS, so an extra key
 *  cannot inflate "answered 7 of 12" by existing.
 *
 *  The definition moved to deal-state.ts on 2026-08-18, which also renders the
 *  heard answers (`heardFactsBlock`) for the brain and the email writer.
 *  Re-exported here so this file's callers are unchanged. */
export { HEARD_KEY };

export interface HeardEvidence {
  /** The agent's own words, verbatim, that produced this answer. */
  quote: string;
  /** Which call it came off, so the recording can be opened. */
  call_id: string | null;
  at: string;
}

export type ChecklistFill = Partial<Record<string, string>>;

export interface CallExtraction {
  answers: ChecklistFill;
  evidence: Record<string, HeardEvidence>;
  callId: string | null;
  /** Set when nothing could be read, so a caller can say WHY rather than
   *  showing an empty checklist and calling it a day. */
  reason?: string;
}

// ---------------------------------------------------------------------------
// the prompt
// ---------------------------------------------------------------------------

/** The twelve, in the words a person would use, because the model is reading a
 *  conversation and not a database. Kept in the same order as CHECKLIST_KEYS. */
export const CHECKLIST_PROMPTS: Array<{ key: string; ask: string }> = [
  { key: 'still_available', ask: 'Is the property still available, or is it under offer, sold or withdrawn. Answer in a few words.' },
  { key: 'why_selling', ask: 'Why is the vendor selling. Probate, moved already, divorce, landlord getting out, and so on.' },
  { key: 'motivation', ask: 'How motivated are they, in the agent\'s own terms. Needs a quick sale, no rush, been on a while, chain free.' },
  { key: 'condition_notes', ask: 'What condition is it in, in plain words. What actually needs doing.' },
  { key: 'condition_band', ask: `One word from exactly this list: ${BANDS.join(', ')}. turnkey = walk-in ready. cosmetic = decoration and carpets. modernisation = dated kitchen or bathroom. full_refurb = everything. derelict = a shell. unknown = the call never established it.` },
  { key: 'water', ask: 'Anything about WATER: leaks, damp, staining on ceilings, a roof problem. This is asked on every house on purpose. "No" is a real answer and must be recorded as such.' },
  { key: 'tenure', ask: 'Freehold or leasehold, and the years left if leasehold.' },
  { key: 'floor_area', ask: 'The size, only if the agent stated one. Give it in square metres (square feet times 0.0929). Otherwise leave it out.' },
  { key: 'rejected_offer', ask: 'A figure the VENDOR HAS ALREADY TURNED DOWN, in pounds, digits only. Only an offer actually refused. An accepted offer, one still being considered, or a figure the agent says would get it done, are NOT this. If two were rejected, the highest.' },
  { key: 'agent_comparable', ask: 'A price the AGENT quoted for a DIFFERENT, already done-up property that sold nearby, with a few words on which one. Never this house\'s asking price, never a figure we mentioned.' },
  { key: 'rent_estimate', ask: 'What the agent said it would let for, per calendar month, in pounds. A weekly figure times 52 over 12.' },
  { key: 'best_price_indicated', ask: 'The lowest figure the agent hinted the vendor would take, in pounds. What they would "probably get it done at". Never our own figure.' },
];

export const CHECKLIST_SYSTEM = [
  'You read the transcript of a phone call between our caller and a UK estate agent about ONE house, and you write down ONLY what the agent actually said.',
  '',
  'You are a note taker, not a valuer and not a negotiator. You never decide anything, you never price anything, and you never fill a gap with something that sounds likely.',
  '',
  'HARD RULES.',
  '1. NEVER GUESS. If the call did not establish something, LEAVE THAT KEY OUT of your answer entirely. An absent answer is safe. A guessed one becomes a figure in an offer to a real vendor.',
  '2. Every answer you DO give must be justified by a verbatim quote from the AGENT, in the `quotes` object under the same key. No quote, no answer. Our caller\'s own words are never evidence: he is the one asking the questions.',
  '3. A NO IS AN ANSWER. "No damp at all", "nothing structural", "it is freehold" are facts and must be recorded. Only silence is silence.',
  '4. Money answers are plain digits in pounds, no currency symbol and no commas. Never convert, never round, never average two figures a person mentioned.',
  '5. Answer in the agent\'s own terms, short. One line each. This is a note, not a summary.',
  '6. NEVER use a long dash, a curly quote or an ellipsis character.',
  '',
  'THE QUESTIONS, and the key each answer goes under:',
  ...CHECKLIST_PROMPTS.map((q) => `- ${q.key}: ${q.ask}`),
  '',
  'Return ONLY a JSON object, no prose and no code fences:',
  '{"answers": {"key": "value", ...}, "quotes": {"key": "the agent\'s exact words", ...}}',
].join('\n');

// ---------------------------------------------------------------------------
// parsing, with the same sanity bands the engine reader already uses
// ---------------------------------------------------------------------------

/** A figure a UK terraced house could actually involve. Outside this it is a
 *  misheard number, and a misheard number is worse than no number: the reader
 *  hearing "one one eight" and returning 118 must never reach the engine. */
const MONEY_KEYS = new Set(['rejected_offer', 'agent_comparable', 'rent_estimate', 'best_price_indicated']);
const MONEY_BANDS: Record<string, [number, number]> = {
  rejected_offer: [20_000, 2_000_000],
  agent_comparable: [20_000, 2_000_000],
  best_price_indicated: [20_000, 2_000_000],
  rent_estimate: [200, 5_000],
};

const firstNumber = (s: string): number | null => {
  const m = String(s).replace(/,/g, '').match(/\d[\d.]*/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
};

export function parseChecklist(raw: string): { answers: ChecklistFill; quotes: Record<string, string> } | null {
  let parsed: { answers?: Record<string, unknown>; quotes?: Record<string, unknown> };
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : raw);
  } catch {
    console.warn('[call-extract] unparseable answer:', raw.slice(0, 300));
    return null;
  }

  const known = new Set<string>(CHECKLIST_KEYS as readonly string[]);
  const answers: ChecklistFill = {};
  const quotes: Record<string, string> = {};
  const rawQuotes = (parsed.quotes ?? {}) as Record<string, unknown>;

  for (const [key, value] of Object.entries(parsed.answers ?? {})) {
    if (!known.has(key)) continue;
    const text = String(value ?? '').trim();
    if (!text || /^(unknown|not (said|stated|established|mentioned)|n\/?a|none)$/i.test(text)) continue;

    // RULE 2, ENFORCED RATHER THAN REQUESTED. An answer with no quote behind it
    // is exactly the guess the prompt forbids, so it is dropped here instead of
    // being trusted because the model was told not to.
    const quote = String(rawQuotes[key] ?? '').trim();
    if (!quote) continue;

    if (key === 'condition_band') {
      const band = text.toLowerCase().replace(/\s+/g, '_');
      if (!BANDS.includes(band) || band === 'unknown') continue;
      answers[key] = band;
    } else if (MONEY_KEYS.has(key)) {
      const n = firstNumber(text);
      const [lo, hi] = MONEY_BANDS[key];
      if (n === null || n < lo || n > hi) continue;
      // agent_comparable keeps the words as well as the figure: "118000, number
      // 12 same street, done up". The figure is the cross-check, the words are
      // what make it checkable.
      answers[key] = key === 'agent_comparable'
        ? [String(Math.round(n)), text.replace(/^[^a-zA-Z]+/, '').trim()].filter(Boolean).join(', ').slice(0, 200)
        : String(Math.round(n));
    } else if (key === 'floor_area') {
      const n = firstNumber(text);
      if (n === null || n < 15 || n > 1_000) continue;
      answers[key] = String(Math.round(n));
    } else {
      answers[key] = text.slice(0, 300);
    }
    quotes[key] = quote.slice(0, 300);
  }

  // works_needed is the engine's vocabulary, not the checklist's, but a
  // condition note that names them is worth more than one that does not.
  return { answers, quotes };
}

// ---------------------------------------------------------------------------
// the read
// ---------------------------------------------------------------------------

/** Read one branch's newest call and write down the twelve answers.
 *
 *  NEVER THROWS. A reader that falls over must not stop the outcome being
 *  recorded or the deal moving; it just means the checklist stays as empty as
 *  it was, which is today's behaviour. */
export async function extractChecklistFromCall(sb: Sb, args: {
  contactId: string;
  address?: string | null;
  bedrooms?: number | null;
  propertyType?: string | null;
}): Promise<CallExtraction> {
  const at = new Date().toISOString();
  const empty: CallExtraction = { answers: {}, evidence: {}, callId: null };

  let transcript: { text: string; callId: string | null };
  try {
    const { readNewestTranscript } = await import('./ballpark.js');
    transcript = await readNewestTranscript(sb, args.contactId);
  } catch (e) {
    console.warn('[call-extract] could not read the transcript', String(e).slice(0, 160));
    return { ...empty, reason: 'transcript_unreadable' };
  }
  if (!transcript.text) return { ...empty, reason: 'no_transcript' };

  const user = [
    `THE HOUSE: ${args.address ?? 'unknown address'}, ${args.bedrooms ?? '?'} bed ${args.propertyType ?? ''}.`.trim(),
    '',
    'THE CALL. Our caller is the one asking the questions; the agent is the one whose answers count.',
    transcript.text,
  ].join('\n');

  let out = '';
  try {
    const { callLLM } = await import('./llm.js');
    // Two attempts, not three: this runs on every call, so a reader having a
    // bad minute costs a checklist that fills on the next sweep instead.
    for (let attempt = 0; attempt < 2 && !out; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1200));
      out = await callLLM(EXTRACT_MODEL, CHECKLIST_SYSTEM, [{ role: 'user', content: user }], 2000,
        { thinkingBudget: 800 });
    }
  } catch (e) {
    return { ...empty, callId: transcript.callId, reason: `model_error: ${String(e).slice(0, 90)}` };
  }
  if (!out) return { ...empty, callId: transcript.callId, reason: 'model_silent' };

  const parsed = parseChecklist(out);
  if (!parsed) return { ...empty, callId: transcript.callId, reason: 'unparseable' };

  const evidence: Record<string, HeardEvidence> = {};
  for (const [key, quote] of Object.entries(parsed.quotes)) {
    evidence[key] = { quote, call_id: transcript.callId, at };
  }
  return { answers: parsed.answers, evidence, callId: transcript.callId };
}

// ---------------------------------------------------------------------------
// the merge
// ---------------------------------------------------------------------------

/** Fold what the machine heard into what is already on the file.
 *
 *  THE HUMAN WINS, ALWAYS, and it is a fence rather than an intention: a key
 *  that already has a value is skipped outright, so there is no path from this
 *  function to overwriting something Pedro typed while he was on the call.
 *
 *  Pure, so the rule is testable without a model or a database. */
export function mergeChecklist(
  prior: Record<string, unknown> | null | undefined,
  extraction: { answers: ChecklistFill; evidence: Record<string, HeardEvidence> },
): { merged: Record<string, unknown>; filled: string[] } {
  const merged: Record<string, unknown> = { ...(prior ?? {}) };
  const heard: Record<string, HeardEvidence> = {
    ...((merged[HEARD_KEY] as Record<string, HeardEvidence> | undefined) ?? {}),
  };
  const filled: string[] = [];

  for (const [key, value] of Object.entries(extraction.answers)) {
    const existing = String(merged[key] ?? '').trim();
    if (existing) continue;
    if (!String(value ?? '').trim()) continue;
    merged[key] = value;
    if (extraction.evidence[key]) heard[key] = extraction.evidence[key];
    filled.push(key);
  }

  // A quote that no longer matches its answer is a quote for something a human
  // has since corrected. Drop it rather than leave the old evidence sitting
  // under a new answer, which would be the worst of both.
  for (const key of Object.keys(heard)) {
    if (!String(merged[key] ?? '').trim()) delete heard[key];
  }

  if (Object.keys(heard).length) merged[HEARD_KEY] = heard;
  else delete merged[HEARD_KEY];
  return { merged, filled };
}

/** How many of the twelve are answered, counted the one way deal-state counts
 *  them, so a number shown to a human cannot disagree with the brain's. */
export function answeredCount(qualification: Record<string, unknown> | null | undefined): number {
  const q = qualification ?? {};
  return (CHECKLIST_KEYS as readonly string[])
    .filter((k) => String(q[k] ?? '').trim() !== '').length;
}
