// The ballpark, callable by MACHINE or button.
//
// Extracted 2026-08-16 from api/crm/fetch-ballpark.ts (which now delegates
// here) so the deal sweep can run the homework ITSELF. Hugo: "Why didn't you
// fetch the ballpark already? You should have said: Hugo, I have run the
// ballpark, those are the numbers, Pedro should call Thursday. Confirm."
//
// Two functions, a hard line between them:
//   runBallparkPreview  hears the call, extracts the facts, asks the engine.
//                       WRITES NOTHING. A refusal is a normal result.
//   applyBallpark       arms call two: band on the card, tokens for the
//                       phone, brief, board move, and (new) Pedro's
//                       follow-up booked at the agreed callback time.
//
// The extraction prompt, the sanity bands on heard money, and the engine
// contract are unchanged from the route, moved verbatim.

import type { SupabaseClient } from '@supabase/supabase-js';
import { callLLM } from './llm.js';
import { QUALIFICATION_QUESTIONS } from './brrr.js';
import { buildNextStepBrief } from './next-step-brief.js';
import { readDealMoney } from './brrr-offer.js';
import { readCallTranscript, formatTranscript } from './call-transcript.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Sb = SupabaseClient<any, any, any>;

const MODEL = 'claude-sonnet-5';
const ENGINE_URL = process.env.SCRAPER_REPRICE_URL || 'https://scraper.heyelsie.com/api/reprice';

// The rate card's whole vocabulary. Anything else the model might say is not
// priceable and must not be invented into the survey.
//
// MOVED to api/lib/condition-vocab.ts, which has no imports, so the dialer can
// name a band without dragging the LLM wrapper and its Supabase client into the
// browser bundle. Re-exported here because half the repo already imports them
// from this file.
export { BANDS, WORKS } from './condition-vocab.js';
import { BANDS, WORKS } from './condition-vocab.js';

const SYSTEM_EXTRACT = [
  'You read the transcripts of one or more phone calls between our caller and a UK estate agent, plus the caller\'s typed notes, and you extract ONLY what the agent actually said about ONE named house: its condition and its size.',
  '',
  'HARD RULES.',
  '0. THE CALLS ARE LABELLED AND IN ORDER, oldest first. Facts are usually won on the earliest call and the latest call is often only about arranging a viewing, so read them ALL: a size given on the first call still counts on the third. Where two calls contradict each other about the same fact, the most recent one wins.',
  '0b. THAT BRANCH SELLS MANY HOUSES. Extract only what was said about the house named below. If a passage is plainly about a different address, ignore it completely rather than borrowing its condition or its size.',
  '1. NEVER guess. If the agent did not establish something, it is unknown or absent. An unpriced unknown is safe; a guessed answer costs real money on a real offer.',
  `2. condition_band is exactly one of: ${BANDS.join(', ')}. turnkey = walk-in ready. cosmetic = decoration and carpets. modernisation = dated kitchen or bathroom, needs bringing up to date. full_refurb = everything needs doing. derelict = a shell, uninhabitable. unknown = the call did not establish it.`,
  `3. works_needed lists only works the agent CONFIRMED, from exactly this vocabulary: ${WORKS.join(', ')}. An agent saying the boiler is old means boiler. An agent saying the roof leaks or there is staining on ceilings means roof or damp. Say nothing the agent did not.`,
  '4. floor_area_sqm only if the agent stated a size on the call (convert sq ft to sq m by multiplying by 0.0929). Otherwise null.',
  '4b. rent_pcm only if the agent stated what the house would let for, per calendar month, in pounds. A weekly figure times 52 over 12. Otherwise null.',
  '4c. agent_comp_price: a price the AGENT quoted for a DIFFERENT, already done-up property that sold nearby, in pounds. This is the answer to "has anything on that street sold recently that was done up, what did it go for". It is NEVER the asking price of this house, never a price we mentioned, and never what the agent thinks this house is worth unfinished. If in any doubt, null.',
  '4d. agent_comp_note: one short line saying which property that figure refers to and roughly when it sold, in the agent\'s own terms, for example "number 12 same street, done up, spring". Null when agent_comp_price is null.',
  '4e. rejected_offer: a figure the VENDOR HAS ALREADY TURNED DOWN, in pounds. Only an offer that was actually refused. An offer that was accepted, one still being considered, or a figure the agent says would get it done, are all null here. If two were rejected, take the highest.',
  '5. heard: up to 6 short verbatim quotes from the AGENT that justify what you extracted, so a human can check every fact against the agent\'s own words.',
  '6. Long dashes, curly quotes and ellipsis characters are forbidden in your output.',
  '',
  'Return ONLY a JSON object, no prose, no code fences:',
  '{"condition_band": "...", "works_needed": [...], "flags": [], "floor_area_sqm": null, "rent_pcm": null, "agent_comp_price": null, "agent_comp_note": null, "rejected_offer": null, "heard": ["..."]}',
].join('\n');

export const money = (n?: number | null) =>
  typeof n === 'number' && Number.isFinite(n) ? `£${Math.round(n).toLocaleString('en-GB')}` : '';

export interface Extraction {
  condition_band: string;
  works_needed: string[];
  flags: string[];
  floor_area_sqm: number | null;
  rent_pcm: number | null;
  /** A done-up sale the AGENT quoted. A cross-check on the end value, never a
   *  replacement for it: the engine takes it only when it is LOWER. */
  agent_comp_price: number | null;
  agent_comp_note: string | null;
  /** What the vendor has already refused. Their floor, so it can only ever
   *  kill a deal, never raise our offer. */
  rejected_offer: number | null;
  heard: string[];
}

export interface BallparkPreview {
  ok: boolean;
  /** Set on a refusal: no_engine_id | nothing_heard | engine_unreachable |
   *  whatever reason the engine itself gives (comps_below_standard,
   *  unpriceable_works, condition_unknown...). */
  reason?: string;
  detail?: string;
  heard?: Extraction;
  engine?: Record<string, unknown>;
  heardCallId?: string | null;
  at?: string;
}

const parseExtraction = (raw: string): Extraction | null => {
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(m ? m[0] : raw) as Partial<Extraction>;
    return {
      condition_band: BANDS.includes(String(parsed.condition_band)) ? String(parsed.condition_band) : 'unknown',
      works_needed: (parsed.works_needed ?? []).map(String).filter((w) => WORKS.includes(w)),
      flags: (parsed.flags ?? []).map(String),
      floor_area_sqm: typeof parsed.floor_area_sqm === 'number' && parsed.floor_area_sqm > 10
        ? parsed.floor_area_sqm : null,
      rent_pcm: typeof parsed.rent_pcm === 'number' && parsed.rent_pcm >= 200 && parsed.rent_pcm <= 5000
        ? Math.round(parsed.rent_pcm) : null,
      // Sanity bands on both money facts. A model that hears "one one eight"
      // and returns 118 must not send a GBP 118 comparable to the engine.
      agent_comp_price: typeof parsed.agent_comp_price === 'number'
        && parsed.agent_comp_price >= 20_000 && parsed.agent_comp_price <= 2_000_000
        ? Math.round(parsed.agent_comp_price) : null,
      agent_comp_note: typeof parsed.agent_comp_note === 'string' && parsed.agent_comp_note.trim()
        ? parsed.agent_comp_note.trim().slice(0, 200) : null,
      rejected_offer: typeof parsed.rejected_offer === 'number'
        && parsed.rejected_offer >= 20_000 && parsed.rejected_offer <= 2_000_000
        ? Math.round(parsed.rejected_offer) : null,
      heard: (parsed.heard ?? []).map(String).slice(0, 6),
    };
  } catch {
    console.warn('[ballpark] unparseable extraction:', raw.slice(0, 400));
    return null;
  }
};

/** The newest outbound call to this branch that actually has words in it.
 *
 *  EXPORTED AND SHARED. `api/lib/call-extract.ts` reads the same transcript for
 *  the checklist, and a second copy of this is how one wrong column list came
 *  to exist in three files: the columns are `body` and `ts`, and asking for
 *  `text, created_at` is a PostgREST error, not an empty result, so the call
 *  silently reads as though it never happened.
 *
 *  A broken read is logged rather than swallowed, for the same reason. */
export async function readNewestTranscript(
  sb: Sb, contactId: string, opts: { cap?: number; scanCalls?: number } = {},
): Promise<{ text: string; callId: string | null }> {
  const { data: calls } = await sb
    .from('wk_calls')
    .select('id, started_at')
    .eq('contact_id', contactId)
    .eq('direction', 'outbound')
    .order('started_at', { ascending: false })
    .limit(opts.scanCalls ?? 5);

  for (const c of (calls ?? []) as Array<{ id: string }>) {
    // The accurate after-call transcript when it exists, Twilio's realtime one
    // when it does not. The homework runs long after the call, so it should
    // never be reading the worse of the two.
    const { lines } = await readCallTranscript(sb as never, c.id, { limit: 300 });
    const text = formatTranscript(lines, opts.cap ?? 14_000);
    if (text.length > 200) return { text, callId: c.id };
  }
  return { text: '', callId: null };
}

/** EVERY recent call to this branch that has words in it, oldest first.
 *
 *  The ballpark cannot use readNewestTranscript, and 19 Aug is why. Pedro's
 *  process is deliberately two calls: the branch answers the condition and
 *  size questions on call one, and call two is the offer. Reading only the
 *  newest call means that the moment call two happens, every fact won on call
 *  one becomes invisible, and the next re-price silently reverts to guessing
 *  the condition from the listing photographs.
 *
 *  On Oundle Road the branch read 74 sqm off the EPC on 18 Aug. The 19 Aug
 *  re-run heard only the viewing-booking call, extracted "the agent made no
 *  statements about the property's condition, size or works", and handed the
 *  engine an empty survey on a house we had spent two calls qualifying.
 *
 *  ONE BRANCH SELLS MANY HOUSES, so this is not simply "read more". The
 *  extraction prompt is told which house it is pricing and to ignore anything
 *  said about a different one, and the calls are labelled and ordered so the
 *  newest statement wins where two disagree. */
export async function readRecentTranscripts(
  sb: Sb, contactId: string, opts: { calls?: number; cap?: number } = {},
): Promise<{ text: string; callIds: string[]; newestId: string | null }> {
  const want = opts.calls ?? 3;
  const { data: calls } = await sb
    .from('wk_calls')
    .select('id, started_at')
    .eq('contact_id', contactId)
    .eq('direction', 'outbound')
    .order('started_at', { ascending: false })
    .limit(Math.max(want * 2, 6));

  const found: Array<{ id: string; startedAt: string | null; text: string }> = [];
  for (const c of (calls ?? []) as Array<{ id: string; started_at: string | null }>) {
    if (found.length >= want) break;
    const { lines } = await readCallTranscript(sb as never, c.id, { limit: 300 });
    const text = formatTranscript(lines, opts.cap ?? 14_000);
    if (text.length > 200) found.push({ id: c.id, startedAt: c.started_at, text });
  }
  if (!found.length) return { text: '', callIds: [], newestId: null };

  const newestId = found[0].id;
  const oldestFirst = [...found].reverse();
  const text = oldestFirst
    .map((c, i) => {
      const when = c.startedAt ? c.startedAt.slice(0, 10) : 'date unknown';
      const label = i === oldestFirst.length - 1 ? 'MOST RECENT CALL' : `EARLIER CALL ${i + 1}`;
      return `--- ${label} (${when}) ---\n${c.text}`;
    })
    .join('\n\n');
  return { text, callIds: oldestFirst.map((c) => c.id), newestId };
}

type PropRow = {
  id: string; source_property_id: string | null; address: string | null;
  asking_price: number | null; price_text: string | null; bedrooms: number | null;
  property_type: string | null; floor_area_sqm: number | null; agent_name: string | null;
  status: string | null; qualification: Record<string, unknown> | null;
  notes: string | null; deal: Record<string, unknown> | null;
  brief: Record<string, unknown> | null; pinned_note: string | null;
  wk_contact_id: string | null; human_agent_id: string | null;
};

async function loadProp(sb: Sb, propertyId: string): Promise<PropRow | null> {
  const { data } = await sb
    .from('brrr_properties')
    .select('id, source_property_id, address, asking_price, price_text, bedrooms, property_type,'
      + ' floor_area_sqm, agent_name, status, qualification, notes, deal, brief, pinned_note,'
      + ' wk_contact_id, human_agent_id')
    .eq('id', propertyId)
    .limit(1);
  // The multi-line select string defeats supabase-js's query parser, so the
  // inferred row is a parser error; PropRow is the real shape.
  return (data?.[0] as unknown as PropRow | undefined) ?? null;
}

/** Hear the call, extract the facts, ask the engine. WRITES NOTHING.
 *
 *  `fast` skips the engine's deep photo pass. It exists for ONE caller: the
 *  mid-call button on call one (Hugo, 19 Aug: press it while the branch is
 *  still on the phone). The photos do not change during a call and the deep
 *  pass is most of the 45 seconds; the runner's post-call re-run keeps
 *  deep:true, so the figures that ARM the deal always had the full look. */
export async function runBallparkPreview(
  sb: Sb, propertyId: string, opts: { fast?: boolean } = {},
): Promise<BallparkPreview> {
  const nowIso = new Date().toISOString();
  const prop = await loadProp(sb, propertyId);
  if (!prop) return { ok: false, reason: 'unknown_property', detail: 'No such property.', at: nowIso };
  if (!prop.source_property_id) {
    return {
      ok: false, reason: 'no_engine_id', at: nowIso,
      detail: 'This property has no engine id on file, so the engine cannot price it.',
    };
  }

  // ---- hear the calls: EVERY recent one, not just the last -------------
  // The facts are won on call one and the offer is made on call two, so the
  // newest call alone throws away the whole survey the moment Pedro rings
  // back. heardCallId stays the NEWEST call, because that is what the
  // freshness check downstream means by "has anything happened since".
  const { text: transcript, newestId: heardCallId } = prop.wk_contact_id
    ? await readRecentTranscripts(sb, prop.wk_contact_id)
    : { text: '', newestId: null };

  // EVERYTHING Pedro typed, driven off QUALIFICATION_QUESTIONS so a new
  // checklist question reaches the engine automatically.
  const qual = (prop.qualification ?? {}) as Record<string, unknown>;
  const typedNotes = [
    ...QUALIFICATION_QUESTIONS
      .map(({ key }) => (qual[key] ? `${key}: ${String(qual[key])}` : ''))
      .filter(Boolean),
    prop.notes ? `free notes: ${String(prop.notes).slice(0, 2_000)}` : '',
  ].filter(Boolean).join('\n');

  if (!transcript && !typedNotes) {
    return {
      ok: false, reason: 'nothing_heard', at: nowIso,
      detail: 'No transcript and no typed checklist answers for this branch yet. The ballpark is built from what the agent said on call one, so there is nothing to build it from.',
    };
  }

  // ---- extract the facts. NEVER FAILS, by construction: three attempts,
  // then degrade to an empty survey (the engine's photo-condition fallback
  // prices most houses anyway). Thinking capped: extraction is mechanical.
  const user = [
    `THE HOUSE: ${prop.address ?? 'unknown address'}, ${prop.bedrooms ?? '?'} bed ${prop.property_type ?? ''}.`,
    '',
    transcript ? `THE CALLS:\n${transcript}` : 'There is no transcript. Work from the typed notes only.',
    '',
    typedNotes ? `THE CALLER'S TYPED NOTES:\n${typedNotes}` : '',
  ].join('\n');

  let heard: Extraction | null = null;
  for (let attempt = 0; attempt < 3 && !heard; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500 * attempt));
    const raw = await callLLM(MODEL, SYSTEM_EXTRACT, [{ role: 'user', content: user }], 2600,
      { thinkingBudget: 1024 });
    if (raw) heard = parseExtraction(raw);
  }
  if (!heard) {
    console.warn('[ballpark] reader gave nothing after 3 attempts, degrading to empty survey');
    heard = {
      condition_band: 'unknown', works_needed: [], flags: ['reader_unavailable'],
      floor_area_sqm: null, rent_pcm: null, agent_comp_price: null,
      agent_comp_note: null, rejected_offer: null, heard: [],
    };
  }

  // ---- ask the engine. THE MONEY IS COMPUTED THERE AND NOWHERE ELSE. ----
  const secret = process.env.PROPERTY_INGEST_SECRET;
  if (!secret) return { ok: false, reason: 'no_secret', detail: 'PROPERTY_INGEST_SECRET is not set', at: nowIso };

  let engine: Record<string, unknown>;
  try {
    const res = await fetch(ENGINE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ingest-secret': secret },
      body: JSON.stringify({
        property_id: prop.source_property_id,
        // THE SHAPE IS THE ENGINE'S, AND IT IS NOT NEGOTIABLE (19 Aug).
        //
        // reprice() takes the condition survey as one argument and every money
        // or size fact as its OWN argument, and app.py reads each of them off
        // the TOP LEVEL of this body. This writer used to post all of them
        // nested inside `survey`, and to call the works list `works` when the
        // engine reads `works_needed`. Nothing threw. The engine simply never
        // saw them and priced the house as if the call had never happened,
        // while `heard` in the row showed the facts sitting right there.
        //
        // Measured on Oundle Road B44, the house Pedro had already opened at:
        // the branch gave us 74 sqm on the call, the engine priced a size-blind
        // median of comps 12 to 23% bigger, and the ballpark came out at
        // GBP 161,500 / GBP 171,000 against a true GBP 128,802 / GBP 145,572.
        // GBP 25,000 of ceiling, on one misplaced key.
        //
        // condition_band was the ONE key in the right place, which is why the
        // note read "condition heard on the call" beside "no floor area on the
        // subject" on a call where the agent read the floor area out loud.
        survey: {
          condition_band: heard.condition_band,
          works_needed: heard.works_needed,
        },
        // The agent's own figure beats anything we inferred; the listing's is
        // the fallback. Sent flat, where the engine actually looks.
        floor_area_sqm: heard.floor_area_sqm ?? prop.floor_area_sqm ?? null,
        rent_pcm: heard.rent_pcm,
        agent_comp_price: heard.agent_comp_price,
        agent_comp_note: heard.agent_comp_note,
        rejected_offer: heard.rejected_offer,
        // The engine re-reads EVERY photograph with the call as context on a
        // deep pass; it only ever runs on a house a human has spent time on.
        // The mid-call button passes fast:true and skips it: the branch is
        // on the phone NOW, and the runner re-does the full pass after.
        deep: !opts.fast,
        call_notes: [
          transcript ? `WHAT THE AGENT SAID ON THE CALL:\n${transcript}` : '',
          typedNotes ? `THE CALLER'S TYPED NOTES:\n${typedNotes}` : '',
        ].filter(Boolean).join('\n\n').slice(0, 6000) || null,
      }),
    });
    engine = await res.json() as Record<string, unknown>;
  } catch (e) {
    return { ok: false, reason: 'engine_unreachable', detail: String(e).slice(0, 160), heard, heardCallId, at: nowIso };
  }

  // The engine may have priced the condition from the LISTING PHOTOS when the
  // call never established it. Reflect that back.
  if (engine.ok && engine.condition_source === 'listing_photos') {
    heard.condition_band = String(engine.refurb_band ?? heard.condition_band);
  }

  if (!engine.ok) {
    return {
      ok: false,
      reason: String(engine.reason ?? 'engine_refused'),
      detail: String(engine.detail ?? ''),
      heard, engine, heardCallId, at: nowIso,
    };
  }
  return { ok: true, heard, engine, heardCallId, at: nowIso };
}

/** Arm call two from a confirmed preview: band on the card (open, never min),
 *  tokens for the phone, the brief, the board move, and Pedro's follow-up at
 *  the agreed callback time. HUMAN-PRESS ONLY: the sweep runs previews, a
 *  person applies them. */
export async function applyBallpark(
  sb: Sb, propertyId: string, preview: BallparkPreview,
  opts?: { dueAt?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  const prop = await loadProp(sb, propertyId);
  if (!prop) return { ok: false, error: 'unknown property' };
  if (!preview.ok || !preview.engine || !preview.heard) {
    return { ok: false, error: 'nothing to apply: the preview is a refusal' };
  }
  const engine = preview.engine;
  const heard = preview.heard;
  const open = Number(engine.open);
  const ceiling = Number(engine.ceiling);
  const ladder = (engine.ladder as number[] | undefined) ?? [];
  const nowIso = new Date().toISOString();
  const qual = (prop.qualification ?? {}) as Record<string, unknown>;

  const mergedQual = {
    ...qual,
    condition_band: heard.condition_band,
    condition_source: String(engine.condition_source ?? 'call'),
    works_needed: heard.works_needed.join(', '),
    ...(heard.floor_area_sqm ? { floor_area_heard_sqm: String(heard.floor_area_sqm) } : {}),
    ...(heard.rent_pcm ? { rent_heard_pcm: String(heard.rent_pcm) } : {}),
    ballpark_at: nowIso,
  };
  const newDeal = {
    ...((prop.deal ?? {}) as Record<string, unknown>),
    // `open`, NEVER only `min`: the band readers want open, and its absence
    // made the dialer show the walk-away as the opening offer (16 Aug audit).
    offer: { open, min: open, max: ceiling, ladder },
    reprice: { ...engine, heard, at: nowIso, call_id: preview.heardCallId ?? null },
  };

  let contactEmail: string | null = null;
  if (prop.wk_contact_id) {
    const { data: c } = await sb
      .from('wk_contacts').select('email').eq('id', prop.wk_contact_id).maybeSingle();
    contactEmail = (c as { email?: string | null } | null)?.email ?? null;
  }

  const brief = buildNextStepBrief({
    property: { ...prop, deal: newDeal },
    outcome: 'qualified',
    qualification: mergedQual,
    step: 'Offer call',
    board: 'Ready for call 2',
    contactEmail,
    now: new Date(),
  });

  const { error: upErr } = await sb
    .from('brrr_properties')
    .update({ qualification: mergedQual, deal: newDeal, brief, updated_at: nowIso })
    .eq('id', prop.id);
  if (upErr) return { ok: false, error: upErr.message };

  if (prop.wk_contact_id) {
    const { data: contact } = await sb
      .from('wk_contacts')
      .select('id, email, custom_fields')
      .eq('id', prop.wk_contact_id)
      .maybeSingle();
    const evidence = ((engine.evidence as Array<Record<string, unknown>> | undefined) ?? [])
      .slice(0, 3)
      .map((c) => `${String(c.address ?? '').split(',')[0]} went for ${money(Number(c.price))} (${String(c.date ?? '')}, ${c.distance_m ?? '?'}m away)`)
      .join('; ');
    // ONE MEANING PER KEY (16 Aug audit): `property_worth` is worth TODAY
    // everywhere (the coach reads it out as "worth today"), and the done-up
    // value lives in `worth_after_bed`. This writer used to put the engine's
    // GDV into property_worth, so the coach told Pedro a house was worth
    // today what it would only be worth AFTER the works. And the ladder key
    // is `ladder`, the one the dialer writes and the script templates read.
    const worthToday = readDealMoney({ deal: prop.deal as Record<string, unknown> | null }).cmv;
    const fields = {
      ...(((contact as { custom_fields?: Record<string, string> } | null)?.custom_fields ?? {}) as Record<string, string>),
      offer_open: money(open),
      offer_ceiling: money(ceiling),
      ladder: ladder.length > 1 ? ladder.map(money).join(', then ') : `${money(open)}, up to ${money(ceiling)}`,
      ...(worthToday ? { property_worth: `${money(worthToday)} today` } : {}),
      worth_after_bed: `${money(Number(engine.gdv))} done up (${String(engine.comps_tier)} comps, ${String(engine.comps_used)} sold nearby)`,
      comp_evidence: evidence || 'see the deal drawer',
      valuation_notes: `Ballpark confirmed ${nowIso.slice(0, 10)} from call one: condition ${heard.condition_band}, refurb ${money(Number(engine.refurb))} at the low end, ${String(engine.comps_tier)} evidence.`,
      next_step: 'Offer call',
      // The ONE signal callModeForStep promotes to call two on. Bare
      // offer_open cannot be it: the nightly assign stamps a band on every
      // priced branch before anyone has rung it (19 Aug, the whole fresh
      // queue opened on call two).
      ballpark_confirmed_at: nowIso,
    };
    await sb.from('wk_contacts').update({ custom_fields: fields }).eq('id', prop.wk_contact_id);

    // The board move: looked up by name ON THE PROPERTY PIPELINE (the one
    // that owns 'Ballpark agreed', same trick as cockpit.ts, because column
    // names repeat across boards), skipped in silence if absent. The band on
    // the card is the point; the column is presentation. The stage_move
    // trigger stamps the history itself.
    const { data: anchor } = await sb
      .from('wk_pipeline_columns').select('pipeline_id').eq('name', 'Ballpark agreed').maybeSingle();
    const pipelineId = (anchor as { pipeline_id?: string } | null)?.pipeline_id ?? null;
    let colQuery = sb.from('wk_pipeline_columns').select('id').eq('name', 'Ready for call 2');
    if (pipelineId) colQuery = colQuery.eq('pipeline_id', pipelineId);
    const { data: col } = await colQuery.maybeSingle();
    if ((col as { id?: string } | null)?.id) {
      await sb.from('wk_contacts')
        .update({ pipeline_column_id: (col as { id: string }).id })
        .eq('id', prop.wk_contact_id);
    }

    // PEDRO'S CALLBACK, BOOKED AT THE APPROVAL. The follow-up carries the
    // property's own agent (his followups banner fires on it), and it is what
    // lets the card LEAVE the cockpit: scheduled work is not a decision.
    if (opts?.dueAt) {
      await sb.from('wk_contact_followups').insert({
        contact_id: prop.wk_contact_id,
        agent_id: prop.human_agent_id ?? null,
        due_at: opts.dueAt,
        status: 'pending',
        note: `Call two: ballpark confirmed. Open at ${money(open)}; the ceiling stays in the room.`,
      });
    }
  }

  return { ok: true };
}
