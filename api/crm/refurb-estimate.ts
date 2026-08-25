// The refurb estimator's back end: load a house, look at it twice, price only
// what a human confirmed.
//
// Hugo, 2026-08-25, upgrading the first version of this screen:
//
//   "The estimator should analyse each property using property/listing
//   information already available in the CRM, property photos from the listing,
//   the agent's phone conversation, and any additional photos uploaded by the
//   agent. NEVER invent work. If there is no clearly necessary work, the result
//   must simply say Nothing to do. Where practical, use multiple AI vision
//   analyses to reduce mistakes and unnecessary recommendations. Every item must
//   require agent confirmation, even if the information came directly from the
//   listing or AI."
//
// THE SPLIT IS UNCHANGED AND STILL NOT NEGOTIABLE. The models do LANGUAGE and
// VISION: they say which jobs on our fixed rate card the evidence supports.
// This route does MONEY, from the card in src/features/crm/lib/refurbCard.ts
// and nowhere else. A model that mishears or misreads a photograph cannot
// invent a number; the worst it can do is name the wrong line, which is on the
// screen next to the photograph it named it from, and correctable.
//
// WHAT IS NEW IS THE VOTE. Two different models read the same house
// independently, and src/features/crm/lib/refurbAssessment.ts merges them by
// intersection: work both of them named is priced, work one of them named is
// SUSPECTED and goes to the builder to confirm, and an area neither of them
// flagged says "Nothing to do". That merge is arithmetic, not judgement, which
// is why it lives in a pure module with a test rather than in a prompt.
//
// AND NOTHING IS PRICED UNTIL A HUMAN SAYS SO. `pricedWorks` refuses to return
// anything from an unconfirmed area, so the total on the screen is the sum of
// what somebody actually agreed to and can never be the sum of what a model
// suggested.
//
// GATE: `wk_is_agent_or_admin`, the same one Pedro's other presses use, for the
// same reason api/crm/find-builders.ts gives at length. Pricing a refurb is his
// job and admin-gating it is how the builder panel ended up blank for him.

import type { IncomingMessage, ServerResponse } from 'http';
import { createClient } from '@supabase/supabase-js';
import { callLLM, type LLMBlock } from '../lib/llm.js';
import { loadViewingHouses } from '../lib/viewing-houses.js';
import { fetchListing, type Listing } from '../lib/rightmove-listing.js';
import { readCallTranscript, formatTranscript } from '../lib/call-transcript.js';
import { heardFactsBlock } from '../lib/deal-state.js';
import {
  cardVocabulary, estimate, builderBrief, SECTIONS, gbp,
} from '../../src/features/crm/lib/refurbCard.js';
import {
  parseVisionRead, mergeReads, blankAreas, pricedWorks, worksToConfirm, toInspect,
  verdictOf, type AreaAssessment, type MergeInput,
} from '../../src/features/crm/lib/refurbAssessment.js';

// 300, NOT 60, AND THAT IS NOT PADDING.
//
// Hugo hit a 504 on the first version of this screen. Two vision reads of up to
// twenty four photographs each is a longer job again, even run side by side.
// api/lib/llm.ts already carries the scar of this exact failure class:
// "unbounded thinking is how ... fetch-ballpark blew the 25 second edge ceiling
// into a 504". Thinking is capped at the floor below; the rest of the time is
// two models actually looking at pictures, so the ceiling has to be generous.
export const config = { maxDuration: 300 };

/** Stop and answer honestly rather than letting the gateway kill us. A 504
 *  answers with an HTML error page the browser cannot parse a reason out of,
 *  and the agent loses everything he has confirmed with nothing to act on. */
const DEADLINE_MS = 270_000;

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

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

/** A listing read older than this is re-fetched. Photographs do not change,
 *  but a listing gets withdrawn, re-priced and re-photographed, and a week is
 *  well inside the life of a deal. */
const LISTING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** The same gate as api/crm/find-builders.ts: a CRM agent or an admin. */
async function requireAgent(req: Request): Promise<{ id: string } | Response> {
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: userResp } = await sb.auth.getUser(jwt);
  if (!userResp?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const caller = createClient(SUPABASE_URL, SERVICE_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: allowed } = await caller.rpc('wk_is_agent_or_admin');
  if (!allowed) return Response.json({ error: 'CRM access required' }, { status: 403 });
  return { id: userResp.user.id };
}

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
  'Long dashes, curly quotes and ellipsis characters are forbidden in your output. Use plain commas and full stops.',
  '',
  'Return ONLY a JSON object, no prose, no code fences:',
  '{"band":"...","summary":"one or two plain sentences","areas":[{"id":"kitchen","verdict":"nothing","summary":"Nothing to do.","evidence":"units dated but sound, worktop intact, no water damage","basis":"photo","photos":[4,5],"works":[]}],"unknowns":["..."]}',
].join('\n');

// ---------------------------------------------------------------------------
// Loading one house
// ---------------------------------------------------------------------------

interface HouseRow {
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

const HOUSE_COLUMNS =
  'id, address, viewing_at, viewing_address, listing_url, asking_price, bedrooms,'
  + ' property_type, floor_area_sqm, price_text, wk_contact_id, qualification, floorplan_urls';

interface StoredAssessment {
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
async function readAssessment(sb: any, propertyId: string): Promise<StoredAssessment | null> {
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
async function readCallEvidence(sb: any, house: HouseRow): Promise<{ facts: string; transcript: string; calls: number }> {
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
async function listingFor(
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
      'THE ADVERT ITSELF. Estate agents write these to sell, so treat "in need of modernisation"',
      'as a selling phrase and not as evidence of work. A specific statement of fact ("no central',
      'heating", "damp to the rear wall", "roof recently replaced") IS evidence.',
      '',
      listing.description.slice(0, 4000),
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
    text: 'Now answer for every part of the property. Remember: the default answer is "Nothing to do", and dated is not work.',
  });
  return blocks;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

interface Body {
  action?: 'houses' | 'load' | 'analyse' | 'save' | 'price';
  propertyId?: string;
  refresh?: boolean;
  areas?: AreaAssessment[];
  address?: string;
  floorAreaSqm?: number | null;
  areaConfirmed?: boolean;
  includeBudget?: boolean;
}

async function handleWeb(req: Request): Promise<Response> {
  if (req.method !== 'POST') return Response.json({ error: 'POST only' }, { status: 405 });
  const who = await requireAgent(req);
  if (who instanceof Response) return who;

  let body: Body;
  try { body = await req.json() as Body; }
  catch { return Response.json({ error: 'Bad JSON' }, { status: 400 }); }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const action = body.action ?? 'houses';

  // ---- the dropdown --------------------------------------------------
  if (action === 'houses') {
    const rows = await loadViewingHouses<HouseRow>(sb, HOUSE_COLUMNS);
    const ids = rows.map((r) => r.id);
    const { data: done } = ids.length
      ? await sb.from('brrr_refurb_assessments').select('property_id, analysed_at, updated_at').in('property_id', ids)
      : { data: [] };
    const byId = new Map(((done ?? []) as Array<{ property_id: string; analysed_at: string | null; updated_at: string }>)
      .map((d) => [d.property_id, d]));
    return Response.json({
      ok: true,
      houses: rows.map((r) => ({
        id: r.id,
        address: r.address,
        viewingAddress: r.viewing_address,
        viewingAt: r.viewing_at,
        bedrooms: r.bedrooms,
        propertyType: r.property_type,
        askingPrice: r.asking_price,
        priceText: r.price_text,
        listingUrl: r.listing_url,
        analysedAt: byId.get(r.id)?.analysed_at ?? null,
        startedAt: byId.get(r.id)?.updated_at ?? null,
      })),
    });
  }

  const propertyId = String(body.propertyId ?? '').trim();
  if (!propertyId) return Response.json({ error: 'propertyId required' }, { status: 400 });

  const { data: house, error: houseErr } = await sb
    .from('brrr_properties').select(HOUSE_COLUMNS).eq('id', propertyId).maybeSingle();
  if (houseErr) return Response.json({ error: houseErr.message }, { status: 500 });
  if (!house) return Response.json({ error: 'That property is not on file.' }, { status: 404 });
  const h = house as HouseRow;

  const stored = await readAssessment(sb, propertyId);

  // ---- open a house --------------------------------------------------
  if (action === 'load') {
    const { listing, fetched } = await listingFor(h, stored, Boolean(body.refresh));
    if (fetched) {
      const { error } = await sb.from('brrr_refurb_assessments').upsert({
        property_id: propertyId,
        listing,
        listing_fetched_at: new Date().toISOString(),
        ...(stored ? {} : { areas: blankAreas() }),
        updated_at: new Date().toISOString(),
        updated_by: who.id,
      }, { onConflict: 'property_id' });
      if (error) console.warn('[refurb] listing cache write failed', error.message);
    }
    const call = await readCallEvidence(sb, h);
    return Response.json({
      ok: true,
      house: houseView(h, listing),
      listing,
      call: { facts: call.facts, transcript: call.transcript.slice(0, 4000), calls: call.calls },
      areas: stored?.areas?.length ? stored.areas : blankAreas(),
      analysedAt: stored?.analysed_at ?? null,
      analysisMeta: stored?.analysis_meta ?? null,
      confirmedAddress: stored?.address ?? null,
      confirmedSqm: stored?.floor_area_sqm ?? null,
      areaConfirmed: Boolean(stored?.area_confirmed),
    });
  }

  // ---- save what the agent confirmed ---------------------------------
  if (action === 'save') {
    const areas = Array.isArray(body.areas) ? body.areas : [];
    const { error } = await sb.from('brrr_refurb_assessments').upsert({
      property_id: propertyId,
      areas,
      address: body.address ?? null,
      floor_area_sqm: body.floorAreaSqm ?? null,
      area_confirmed: Boolean(body.areaConfirmed),
      updated_at: new Date().toISOString(),
      updated_by: who.id,
    }, { onConflict: 'property_id' });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  }

  // ---- price it, with no model anywhere near the arithmetic -----------
  if (action === 'price') {
    const areas = (Array.isArray(body.areas) ? body.areas : []) as AreaAssessment[];
    const est = estimate(pricedWorks(areas), { floorAreaSqm: body.floorAreaSqm ?? null });
    const confirm = worksToConfirm(areas);
    const inspect = toInspect(areas);
    est.unknowns = (stored?.analysis_meta?.unknowns as string[] | undefined) ?? [];
    const brief = builderBrief(est.lines, {
      address: body.address ?? h.address ?? '',
      includeBudget: body.includeBudget !== false,
      budget: est.budget,
      unknowns: est.unknowns,
      toConfirm: confirm,
      toInspect: inspect,
    });
    return Response.json({
      ok: true,
      estimate: est,
      toConfirm: confirm,
      toInspect: inspect,
      nothingToDo: areas.filter((a) => a.confirmed && verdictOf(a) === 'nothing').map((a) => a.label),
      unconfirmed: areas.filter((a) => !a.confirmed).map((a) => a.label),
      brief,
    });
  }

  // ---- look at it, twice ---------------------------------------------
  if (action !== 'analyse') return Response.json({ error: 'Unknown action' }, { status: 400 });

  const priorAreas = (Array.isArray(body.areas) && body.areas.length ? body.areas : stored?.areas) ?? blankAreas();
  const { listing } = await listingFor(h, stored, Boolean(body.refresh));
  const call = await readCallEvidence(sb, h);

  const blocks = evidenceBlocks(h, listing, call, priorAreas);
  const started = Date.now();
  const timeLeft = () => DEADLINE_MS - (Date.now() - started);

  // Both readers at once. Sequentially this is two long vision calls back to
  // back and the gateway ceiling starts to matter; side by side it is one.
  const settled = await Promise.all(READERS.map(async (r) => {
    try {
      const raw = await callLLM(r.model, SYSTEM, [{ role: 'user', content: blocks }], 6000,
        { thinkingBudget: 1024 });
      const read = raw ? parseVisionRead(raw) : null;
      if (!read && raw) console.warn(`[refurb] ${r.id} unparseable:`, raw.slice(0, 400));
      return { id: r.id, model: r.model, read };
    } catch (e) {
      // ONE READER FAILING MUST NOT LOSE THE OTHER. It costs the vote, and the
      // merge handles that by refusing to mark anything "agreed", so a single
      // reader's findings all come back as suspected rather than as fact.
      console.warn(`[refurb] ${r.id} threw`, String(e).slice(0, 200));
      return { id: r.id, model: r.model, read: null };
    }
  }));

  const good = settled.filter((s) => s.read) as Array<{ id: string; model: string; read: NonNullable<ReturnType<typeof parseVisionRead>> }>;
  if (!good.length) {
    const ranOut = timeLeft() <= 0;
    return Response.json({
      error: ranOut
        ? 'That took too long to read. Nothing you have confirmed is lost, it is all still on this page. Press the button again.'
        : 'Neither reader could make sense of this property. Nothing you have confirmed is lost. Try the button again, and if it happens twice, fill the parts in yourself and price it from those.',
    }, { status: 502 });
  }

  const inputs: MergeInput[] = good.map((g) => ({ reader: g.id, read: g.read }));
  const areas = mergeReads(inputs, priorAreas);

  // Unknowns from every reader that answered, deduped, because "what nobody can
  // tell from here" is additive and each reader notices different ones.
  const unknowns = [...new Set(good.flatMap((g) => g.read.unknowns))].slice(0, 12);
  const meta = {
    readers: good.map((g) => ({ id: g.id, model: g.model })),
    failed: settled.filter((s) => !s.read).map((s) => s.id),
    band: good[0].read.band ?? null,
    summary: good[0].read.summary ?? null,
    unknowns,
    seconds: Math.round((Date.now() - started) / 1000),
    photos: listing?.photos.length ?? 0,
    usedCall: Boolean(call.transcript || call.facts),
  };

  const { error } = await sb.from('brrr_refurb_assessments').upsert({
    property_id: propertyId,
    listing,
    listing_fetched_at: listing ? new Date().toISOString() : null,
    areas,
    analysis_meta: meta,
    analysed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    updated_by: who.id,
  }, { onConflict: 'property_id' });
  if (error) console.warn('[refurb] assessment write failed', error.message);

  return Response.json({ ok: true, areas, analysisMeta: meta, analysedAt: new Date().toISOString(), listing });
}

function houseView(h: HouseRow, listing: Listing | null) {
  return {
    id: h.id,
    address: h.address,
    viewingAddress: h.viewing_address,
    viewingAt: h.viewing_at,
    listingUrl: h.listing_url,
    askingPrice: h.asking_price,
    priceText: h.price_text,
    bedrooms: listing?.bedrooms ?? h.bedrooms,
    bathrooms: listing?.bathrooms ?? null,
    propertyType: listing?.propertySubType ?? h.property_type,
    tenure: listing?.tenure ?? null,
    // THE LISTING'S FIGURE IS NOT A FACT UNTIL THE AGENT AGREES WITH IT. Both
    // are sent, labelled, and the screen makes him confirm which one to price
    // from (Hugo: "Any information fetched automatically from the listing must
    // still be confirmed by the agent before being used in the final quote").
    floorAreaSqm: h.floor_area_sqm,
    listingFloorAreaSqm: listing?.floorAreaSqm ?? null,
    floorplans: listing?.floorplans ?? (Array.isArray(h.floorplan_urls) ? h.floorplan_urls as string[] : []),
  };
}

// NODE, NOT EDGE, AND THAT IS WHY THIS ADAPTER EXISTS.
//
// The read can take a minute or more, so this function needs `maxDuration`, and
// `maxDuration` means a Node serverless function. A Node function is handed
// `IncomingMessage`/`ServerResponse`, NOT the Web `Request`/`Response` that
// `runtime: 'edge'` routes like api/crm/cockpit.ts get.
//
// Shipping it with a Web-style signature and a Node config is a 500 on every
// call, `TypeError: req.headers.get is not a function`, thrown before the auth
// check so it does not even 401. It typechecks perfectly, because the signature
// is a promise about a runtime the config quietly opted out of. Caught in
// production on 2026-08-25, five minutes after the first deploy.
//
// Same adapter, same reason, as api/crm/find-builders.ts.
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (v !== undefined) headers[k] = Array.isArray(v) ? v.join(',') : String(v);
  }
  const out = await handleWeb(new Request(`http://internal${req.url ?? '/'}`, {
    method: req.method,
    headers,
    body: chunks.length ? Buffer.concat(chunks) : undefined,
  }));
  res.statusCode = out.status;
  out.headers.forEach((v, k) => res.setHeader(k, v));
  res.end(Buffer.from(await out.arrayBuffer()));
}
