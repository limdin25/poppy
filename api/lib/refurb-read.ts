// One reading of one house: the evidence, the two readers, and the merge.
//
// LIFTED OUT OF api/crm/refurb-estimate.ts on 2026-08-25, the same day it was
// written, because Hugo asked for the reading to happen on its own:
//
//   "When the property gets transferred to the estimator, please make sure it is
//   already read, instead of waiting for me to press read. When Pedro finishes
//   the calls, if he booked the viewing, send to the estimator and read it
//   instead of waiting for me to click it."
//
// So there are now two doors into the same reading: the button on the screen
// (api/crm/refurb-estimate.ts, action "analyse") and the sweep that reads a
// house the moment a viewing is booked for it (api/cron/refurb-read.ts). One
// implementation, because two would drift and the whole point of this feature
// is that the answer is defensible.
//
// THE SPLIT IS UNCHANGED AND NOT NEGOTIABLE. The models do LANGUAGE and VISION:
// they say which jobs on our fixed rate card the evidence supports. They never
// price anything. The money is worked out afterwards from the rate card in
// src/features/crm/lib/refurbCard.ts and nowhere else.

import { callLLM, type LLMBlock } from './llm.js';
import { fetchListing, type Listing } from './rightmove-listing.js';
import { readCallTranscript, formatTranscript } from './call-transcript.js';
import { heardFactsBlock } from './deal-state.js';
import { cardVocabulary, SECTIONS, gbp } from '../../src/features/crm/lib/refurbCard.js';
import {
  parseVisionRead, mergeReads, blankAreas, sizeCandidates,
  type AreaAssessment, type MergeInput, type SizeCandidate,
} from '../../src/features/crm/lib/refurbAssessment.js';

/** Stop and answer honestly rather than letting the gateway kill us. A 504
 *  answers with an HTML error page the browser cannot parse a reason out of,
 *  and the agent loses everything he has confirmed with nothing to act on. */
export const DEADLINE_MS = 270_000;

/** A listing read older than this is re-fetched. Photographs do not change,
 *  but a listing gets withdrawn, re-priced and re-photographed, and a week is
 *  well inside the life of a deal. */
export const LISTING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** TWO DIFFERENT MODELS, ON PURPOSE.
 *
 *  Running one model twice mostly buys you the same answer twice: it leans the
 *  same way about the same picture. Two different families disagree in
 *  different places, and the disagreements are exactly what we want to catch,
 *  because a job only one of them can see is a job nobody should be paying for
 *  off a photograph. Sonnet reads carefully, Haiku is cheap and blunt, and the
 *  merge only prices what both of them independently named. */
const READERS = [
  { id: 'sonnet', model: 'claude-sonnet-5' },
  { id: 'haiku', model: 'claude-haiku-4-5-20251001' },
] as const;

// ---------------------------------------------------------------------------
// The prompt. Every line of it is a fence against a model being helpful.
// ---------------------------------------------------------------------------

const AREA_LIST = SECTIONS.map((s) => `- ${s.id} (${s.label}): ${s.look}`).join('\n');

const SYSTEM = [
  'You are surveying a UK house that we are thinking of buying and then LETTING OUT. You have the estate agent\'s own photographs of it, the listing text, and what the estate agent said on the phone.',
  '',
  'THERE IS ONE QUESTION AND IT IS ASKED SEPARATELY FOR EACH PART OF THE PROPERTY: is there work here that is GENUINELY NECESSARY to make this part of the house sound, safe and rentable?',
  '',
  'THE DEFAULT ANSWER IS "Nothing to do". Most parts of most houses need nothing. A survey that finds something in every room is a survey nobody can trust, and it costs us real money on a real offer.',
  '',
  'DATED IS NOT WORK. This is the rule you will be most tempted to break. All of the following are "Nothing to do":',
  '- an old fashioned kitchen whose units, doors and worktop are sound',
  '- a coloured or 1980s bathroom suite that is not cracked, stained or leaking',
  '- patterned or plain carpet that is worn but clean and unripped',
  '- old wallpaper, textured ceilings, magnolia walls, tired paint',
  '- an old boiler and old radiators that the listing or the agent says work',
  '- a plain garden, a concrete yard, an old shed that is standing up',
  '- old but working windows and doors',
  'We are letting this house. We are not selling it and nobody is moving into it. Do not modernise, do not improve, do not tidy up. Only repair.',
  '',
  'WHAT IS ACTUALLY WORK: missing or broken things, water coming in, damp, black mould, rot, holes, collapsed or sagging structure, a roof missing its covering, an unusable kitchen or bathroom, no heating at all, floors with nothing on them, an electrical installation that is plainly original, a garden you cannot walk through, and a house full of somebody else\'s belongings that has to be cleared.',
  '',
  'THREE VERDICTS AND NOTHING ELSE:',
  '  "nothing"  no necessary work. Say so plainly.',
  '  "work"     necessary work you can SEE in a photograph, or that the listing or the estate agent states as fact. It must be expressible with one of the job keys below.',
  '  "inspect"  something may be wrong but a photograph cannot settle it, OR there is no photograph of this part of the property at all. Use this rather than guessing in either direction.',
  '',
  'NEVER INVENT WORK. If you did not see it, did not read it and were not told it, it does not exist. "Probably", "typically for a house of this age", "likely needs" and "would benefit from" are all forbidden reasons. If you catch yourself reasoning from the age or the style of the house, the answer is "inspect" at most and usually "nothing".',
  '',
  'THE PARTS OF THE PROPERTY. Answer for EVERY ONE of these, even if the answer is "nothing":',
  AREA_LIST,
  '',
  'THE JOB KEYS. These are the only jobs that exist. A job you cannot express with one of these keys is NOT a job: put it in `unknowns` as a sentence instead. Never invent a key.',
  '',
  cardVocabulary(),
  '',
  'FIELD BY FIELD:',
  '- `id` is the part of the property, exactly as spelled above.',
  '- `verdict` is one of nothing, work, inspect.',
  '- `summary` is ONE plain sentence a non-builder understands. When the verdict is "nothing" it is literally "Nothing to do." and nothing else.',
  '- `evidence` is what you can actually see, in a few words, or the estate agent\'s own words. Never write evidence you do not have. An empty evidence field is better than an invented one.',
  '- `basis` is "photo" if a photograph shows it, "listing" if the listing text states it, "agent" if the estate agent or our own agent said it, "none" if there is no evidence at all.',
  '- `photos` is the numbers of the photographs that show this part of the property. The photographs are numbered for you. Put every photograph in the part of the property it belongs to.',
  '- `works` is empty unless the verdict is "work". Each entry is {"key": "...", "detail": "one line a builder can quote against", "qty": 1, "portion": 1}.',
  '- `qty` is only for per item jobs and only when there is genuinely more than one, for example two bathrooms.',
  '- `portion` is for whole house jobs: 1 for the whole house, or roughly the fraction that needs it.',
  '- Never put a whole house job on more than one part of the property. Put it where it is most obvious and leave it off the rest.',
  '',
  '`unknowns` is the honest half of the answer: things nobody can judge without standing in the house, specific to THIS house rather than a generic list.',
  '`band` is one of turnkey, cosmetic, modernisation, full_refurb, derelict, based on the whole picture.',
  '',
  'HOW BIG IS THE HOUSE. This is a separate job and you must do it properly, because the floor area rescales every price we work out afterwards. Look in three places, in this order:',
  '  1. A TOTAL PRINTED ON THE FLOOR PLAN. Plans often print one, as "Total area: approx. 76.0 sq m" or "1076 sq ft". If you find one, `floorArea.sqm` is that figure in square metres (divide square feet by 10.764), `source` is "floorplan_total" and `quote` is the exact printed words.',
  '  2. A SIZE WRITTEN IN THE ADVERT, for example "approximately 964 sq ft". Then `source` is "listing_text" and `quote` is the exact words.',
  '  3. NO TOTAL ANYWHERE. Many plans print only room by room dimensions. Then leave `sqm` null, `source` "none", and instead LIST THE ROOMS in `rooms` with their metric dimensions exactly as printed: [{"name":"Kitchen","m":[3.60,2.64]}]. Include every room on every floor. Do NOT add them up yourself and do NOT put the sum in `sqm`, because a room list leaves out the hall, the stairs and the walls and would understate the house by about a quarter. We do that sum ourselves, and we label it.',
  'NEVER estimate a floor area by eye, from the number of bedrooms, or from what a house like this usually is. A guessed size is worse than no size, because no size is priced as a typical terrace and says so.',
  'The FLOOR AREA line in "THE HOUSE" below is our own note of what the website already told us. It is not the advert and it is not the plan, so never quote it back as `listing_text`. Only report a figure you found in the advert wording itself or printed on the plan.',
  '',
  'Long dashes, curly quotes and ellipsis characters are forbidden in your output. Use plain commas and full stops.',
  '',
  'Return ONLY a JSON object, no prose, no code fences:',
  '{"band":"...","summary":"one or two plain sentences","areas":[{"id":"kitchen","verdict":"nothing","summary":"Nothing to do.","evidence":"units dated but sound, worktop intact, no water damage","basis":"photo","photos":[4,5],"works":[]}],"floorArea":{"sqm":null,"source":"none","quote":"","rooms":[{"name":"Kitchen","m":[3.6,2.64]}]},"unknowns":["..."]}',
].join('\n');

// ---------------------------------------------------------------------------
// Loading one house
// ---------------------------------------------------------------------------

export interface HouseRow {
  id: string;
  address: string | null;
  viewing_at: string | null;
  viewing_address: string | null;
  listing_url: string | null;
  asking_price: number | null;
  bedrooms: number | null;
  property_type: string | null;
  floor_area_sqm: number | null;
  price_text: string | null;
  wk_contact_id: string | null;
  qualification: Record<string, unknown> | null;
  floorplan_urls: unknown;
}

export const HOUSE_COLUMNS =
  'id, address, viewing_at, viewing_address, listing_url, asking_price, bedrooms,'
  + ' property_type, floor_area_sqm, price_text, wk_contact_id, qualification, floorplan_urls';

export interface StoredAssessment {
  property_id: string;
  listing: Listing | null;
  listing_fetched_at: string | null;
  areas: AreaAssessment[];
  analysis_meta: Record<string, unknown> | null;
  analysed_at: string | null;
  address: string | null;
  floor_area_sqm: number | null;
  area_confirmed: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readAssessment(sb: any, propertyId: string): Promise<StoredAssessment | null> {
  const { data, error } = await sb
    .from('brrr_refurb_assessments')
    .select('*')
    .eq('property_id', propertyId)
    .maybeSingle();
  if (error) console.warn('[refurb] assessment read failed', error.message);
  return (data ?? null) as StoredAssessment | null;
}

/** What the estate agent has already told us about this house, and what was
 *  said on the last call. Both are inputs to the reading, because the agent's
 *  own words outrank a photograph on anything a photograph cannot show. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readCallEvidence(sb: any, house: HouseRow): Promise<{ facts: string; transcript: string; calls: number }> {
  const facts = heardFactsBlock(house.qualification ?? null);
  if (!house.wk_contact_id) return { facts, transcript: '', calls: 0 };
  const { data: calls, error } = await sb
    .from('wk_calls')
    .select('id, started_at')
    .eq('contact_id', house.wk_contact_id)
    .order('started_at', { ascending: false })
    .limit(3);
  if (error) console.warn('[refurb] call read failed', error.message);
  const rows = (calls ?? []) as Array<{ id: string }>;
  if (!rows.length) return { facts, transcript: '', calls: 0 };
  // The newest call that actually has words in it. A dialled-and-dropped call
  // sits on top of the list with nothing behind it, and taking it on trust is
  // how "no transcript" gets reported on a house that has been discussed.
  for (const row of rows) {
    const { lines } = await readCallTranscript(sb, row.id, { limit: 250 });
    if (lines.length) return { facts, transcript: formatTranscript(lines, 9000), calls: rows.length };
  }
  return { facts, transcript: '', calls: rows.length };
}

/** The cached listing, refetched when it is missing or stale. */
export async function listingFor(
  house: HouseRow, stored: StoredAssessment | null, force: boolean,
): Promise<{ listing: Listing | null; fetched: boolean }> {
  const age = stored?.listing_fetched_at ? Date.now() - Date.parse(stored.listing_fetched_at) : Infinity;
  if (!force && stored?.listing && Number.isFinite(age) && age < LISTING_TTL_MS) {
    return { listing: stored.listing, fetched: false };
  }
  if (!house.listing_url) return { listing: stored?.listing ?? null, fetched: false };
  const fresh = await fetchListing(house.listing_url);
  // A refused fetch keeps whatever we already had rather than emptying the
  // page. Stale photographs beat no photographs.
  if (!fresh) return { listing: stored?.listing ?? null, fetched: false };
  return { listing: fresh, fetched: true };
}

// ---------------------------------------------------------------------------
// The reading
// ---------------------------------------------------------------------------

function evidenceBlocks(
  house: HouseRow, listing: Listing | null, call: { facts: string; transcript: string },
  areas: AreaAssessment[],
): LLMBlock[] {
  const facts = [
    `ADDRESS: ${house.address ?? 'not given'}`,
    house.asking_price ? `ASKING PRICE: ${gbp(house.asking_price)}` : '',
    `TYPE: ${listing?.propertySubType ?? house.property_type ?? 'not given'}`,
    `BEDROOMS: ${listing?.bedrooms ?? house.bedrooms ?? 'not given'}`,
    `FLOOR AREA: ${listing?.floorAreaSqm ?? house.floor_area_sqm ?? 'not given'} square metres`,
    listing?.tenure ? `TENURE: ${listing.tenure}` : '',
  ].filter(Boolean).join('\n');

  const parts: string[] = [`THE HOUSE.\n${facts}`];

  if (listing?.keyFeatures.length) {
    parts.push(`WHAT THE ESTATE AGENT PUTS ON THE ADVERT AS ITS KEY FEATURES.\n${
      listing.keyFeatures.map((k) => `- ${k}`).join('\n')}`);
  }
  if (listing?.description) {
    parts.push([
      'THE ADVERT ITSELF, IN FULL. Read all of it, including the end: a size, "no central heating",',
      '"sold as seen" and "cash buyers only" are usually in the last paragraph rather than the first.',
      'Estate agents write these to sell, so treat "in need of modernisation" as a selling phrase and',
      'not as evidence of work. A specific statement of fact ("no central heating", "damp to the rear',
      'wall", "roof recently replaced", "964 sq ft") IS evidence.',
      '',
      // WHOLE, not a slice. The 4,000 character cut this replaces threw away
      // the end of five of the eight live adverts, which is where an agent
      // puts the size and the warnings.
      listing.description,
    ].join('\n'));
  }
  if (call.facts) {
    parts.push([
      'WHAT THE ESTATE AGENT HAS ALREADY ANSWERED ON THE PHONE, with their own words.',
      'This is the strongest evidence you have about anything a photograph cannot show.',
      'Never contradict it.',
      '',
      call.facts,
    ].join('\n'));
  }
  if (call.transcript) {
    parts.push(`THE PHONE CALL WITH THE ESTATE AGENT.\n\n${call.transcript}`);
  }

  const notes = areas
    .filter((a) => (a.agentNote ?? '').trim())
    .map((a) => `${a.label.toUpperCase()}: ${a.agentNote.trim()}`);
  if (notes.length) {
    parts.push([
      'WHAT OUR OWN AGENT SAYS ABOUT THE PROPERTY. He has looked at it himself.',
      'His words OUTRANK the photographs and the advert on anything they cover.',
      '',
      notes.join('\n\n'),
    ].join('\n'));
  }

  const blocks: LLMBlock[] = [{ type: 'text', text: parts.join('\n\n') }];

  // THE FLOOR PLAN GOES FIRST, and at full size. It is the only picture with
  // words on it: it answers how big the house is, how the rooms sit together
  // and whether there is a room to add. The first version of this route drew
  // the plan on the screen and never showed it to a model at all.
  if (listing?.floorplans.length) {
    blocks.push({
      type: 'text',
      text: `THE FLOOR PLAN, ${listing.floorplans.length} page${listing.floorplans.length > 1 ? 's' : ''}.`
        + ' Read the total floor area off it if one is printed. If none is printed, read out every'
        + ' room and its metric dimensions instead, exactly as printed, into `floorArea.rooms`.',
    });
    for (const plan of listing.floorplans) {
      blocks.push({ type: 'image', source: { type: 'url', url: plan } });
    }
  }

  if (listing?.photos.length) {
    blocks.push({
      type: 'text',
      text: `THE ${listing.photos.length} PHOTOGRAPHS FROM THE ADVERT, numbered. Use these numbers in \`photos\`.`,
    });
    listing.photos.forEach((p, i) => {
      blocks.push({ type: 'text', text: `PHOTOGRAPH ${i}${p.caption ? ` (agent's caption: ${p.caption})` : ''}` });
      blocks.push({ type: 'image', source: { type: 'url', url: p.thumb } });
    });
  } else {
    blocks.push({
      type: 'text',
      text: 'THERE ARE NO PHOTOGRAPHS AVAILABLE. Judge only from the words above, and use "inspect" for anything the words do not cover.',
    });
  }

  // Photographs the agent took himself, last, so they are the most recent
  // thing the model looked at. These are the only pictures of the inside of a
  // house nobody has photographed properly.
  const extra = areas.flatMap((a) => (a.agentPhotos ?? []).map((url) => ({ label: a.label, url })));
  if (extra.length) {
    blocks.push({ type: 'text', text: 'PHOTOGRAPHS OUR OWN AGENT TOOK. These are current and they outrank the advert photographs.' });
    for (const e of extra.slice(0, 12)) {
      blocks.push({ type: 'text', text: `AGENT PHOTOGRAPH, ${e.label}` });
      blocks.push({ type: 'image', source: { type: 'url', url: e.url } });
    }
  }

  blocks.push({
    type: 'text',
    text: 'Now answer for every part of the property, and answer the floor area question from the plan and the advert.'
      + ' Remember: the default answer is "Nothing to do", and dated is not work.',
  });
  return blocks;
}


// ---------------------------------------------------------------------------
// The reading itself
// ---------------------------------------------------------------------------

export interface ReadOutcome {
  ok: boolean;
  /** Set when nothing could be read. Already in words a human can act on. */
  error?: string;
  ranOut?: boolean;
  areas?: AreaAssessment[];
  meta?: Record<string, unknown>;
  listing?: Listing | null;
  sizes?: SizeCandidate[];
}

/**
 * Look at one house, twice, and merge the two answers conservatively.
 *
 * Writes the result to `brrr_refurb_assessments` itself, so both callers get
 * the same row and neither has to remember to save.
 */
export async function readProperty(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  house: HouseRow,
  opts: { areas?: AreaAssessment[]; refresh?: boolean; by?: string | null; sweep?: boolean } = {},
): Promise<ReadOutcome> {
  const stored = await readAssessment(sb, house.id);
  const priorAreas = (opts.areas?.length ? opts.areas : stored?.areas) ?? blankAreas();
  const { listing } = await listingFor(house, stored, Boolean(opts.refresh));
  const call = await readCallEvidence(sb, house);

  const blocks = evidenceBlocks(house, listing, call, priorAreas);
  const started = Date.now();

  // Both readers at once. Sequentially this is two long vision calls back to
  // back and the gateway ceiling starts to matter; side by side it is one.
  //
  // EACH READER GETS A SECOND GO, and that is not belt and braces. Measured on
  // the first ten real houses, 2026-08-25: six of them came back with only one
  // reader, always Haiku, and re-running the same house immediately got both.
  // So the failures were transient, a rate limit or an overload from the sweep
  // firing four calls a minute, and `callLLM` answers those by logging and
  // returning an empty string with no retry at all.
  //
  // A LOST READER IS NOT A HARMLESS LOSS. With one reader the merge correctly
  // refuses to mark anything as agreed, so every finding becomes "suspected"
  // and NOTHING gets priced. The house looks assessed and produces a zero. One
  // cheap retry is the difference between a real answer and an empty one.
  const settled = await Promise.all(READERS.map(async (r) => {
    let attempts = 0;
    while (attempts < 2 && Date.now() - started < DEADLINE_MS - 60_000) {
      attempts += 1;
      try {
        const raw = await callLLM(r.model, SYSTEM, [{ role: 'user', content: blocks }], 8000,
          { thinkingBudget: 1024 });
        const read = raw ? parseVisionRead(raw) : null;
        if (read) return { id: r.id, model: r.model, read, attempts };
        console.warn(`[refurb] ${r.id} attempt ${attempts} gave ${raw ? 'unparseable' : 'nothing'}`,
          raw.slice(0, 300));
      } catch (e) {
        // ONE READER FAILING MUST NOT LOSE THE OTHER, and must not throw away
        // the work the other one is doing right now.
        console.warn(`[refurb] ${r.id} attempt ${attempts} threw`, String(e).slice(0, 200));
      }
      // A rate limit needs a moment, not another immediate hammer.
      if (attempts < 2) await new Promise((res) => setTimeout(res, 2500));
    }
    return { id: r.id, model: r.model, read: null, attempts };
  }));

  const good = settled.filter((s) => s.read) as Array<{
    id: string; model: string; attempts: number;
    read: NonNullable<ReturnType<typeof parseVisionRead>>;
  }>;
  if (!good.length) {
    const ranOut = Date.now() - started >= DEADLINE_MS;
    const error = ranOut
      ? 'That took too long to read. Nothing you have confirmed is lost, it is all still on this page. Press the button again.'
      : 'Neither reader could make sense of this property. Nothing you have confirmed is lost. Try the button again, and if it happens twice, fill the parts in yourself and price it from those.';

    // A FAILURE HAS TO BE WRITTEN DOWN, or the sweep never stops paying for it.
    // Oxford Gardens, Stafford failed both readers on every single run (one of
    // its four "floor plans" was a 3D tour page, not a picture), and because a
    // failed read wrote no row, the sweep's spend cap never counted it and it
    // came back every ten minutes for ever. Four model calls a time.
    if (opts.sweep) {
      const prior = (stored?.analysis_meta ?? {}) as Record<string, unknown>;
      const { error: writeErr } = await sb.from('brrr_refurb_assessments').upsert({
        property_id: house.id,
        ...(listing ? { listing, listing_fetched_at: new Date().toISOString() } : {}),
        analysis_meta: {
          ...prior,
          sweeps: Number(prior.sweeps ?? 0) + 1,
          lastError: error.slice(0, 200),
          lastFailedAt: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'property_id' });
      if (writeErr) console.warn('[refurb] failure write failed', writeErr.message);
    }

    return { ok: false, ranOut, error };
  }

  const inputs: MergeInput[] = good.map((g) => ({ reader: g.id, read: g.read }));
  const areas = mergeReads(inputs, priorAreas);

  // Unknowns from every reader that answered, deduped, because "what nobody can
  // tell from here" is additive and each reader notices different ones.
  const unknowns = [...new Set(good.flatMap((g) => g.read.unknowns))].slice(0, 12);
  // Kept raw, one per reader, so `sizeCandidates` can say whether they agreed
  // and so re-opening the house does not need another paid reading to know how
  // big it is.
  const floorAreas = good.map((g) => g.read.floorArea).filter(Boolean);
  const sizes = sizeCandidates({
    listingSqm: listing?.floorAreaSqm ?? house.floor_area_sqm ?? null,
    textSqm: listing?.textFloorArea ?? null,
    reads: floorAreas,
  });
  const meta = {
    readers: good.map((g) => ({ id: g.id, model: g.model, attempts: g.attempts })),
    failed: settled.filter((s) => !s.read).map((s) => s.id),
    band: good[0].read.band ?? null,
    summary: good[0].read.summary ?? null,
    unknowns,
    floorAreas,
    seconds: Math.round((Date.now() - started) / 1000),
    photos: listing?.photos.length ?? 0,
    floorplans: listing?.floorplans.length ?? 0,
    descriptionChars: listing?.description.length ?? 0,
    usedCall: Boolean(call.transcript || call.facts),
    // How many times the unattended sweep has read this house. The sweep uses
    // it as a spend cap: it will come back for a house that only got one
    // reader, but not forever. A press on the screen is not counted, because a
    // human asking for it again is a human deciding to spend it.
    sweeps: opts.sweep
      ? Number((stored?.analysis_meta as Record<string, unknown> | null)?.sweeps ?? 0) + 1
      : Number((stored?.analysis_meta as Record<string, unknown> | null)?.sweeps ?? 0),
  };

  const { error } = await sb.from('brrr_refurb_assessments').upsert({
    property_id: house.id,
    listing,
    listing_fetched_at: listing ? new Date().toISOString() : null,
    areas,
    analysis_meta: meta,
    analysed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...(opts.by ? { updated_by: opts.by } : {}),
  }, { onConflict: 'property_id' });
  if (error) console.warn('[refurb] assessment write failed', error.message);

  return { ok: true, areas, meta, listing, sizes };
}
