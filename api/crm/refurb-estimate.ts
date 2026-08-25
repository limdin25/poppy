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
import { loadViewingHouses } from '../lib/viewing-houses.js';
import { type Listing } from '../lib/rightmove-listing.js';
import {
  readProperty, readAssessment, readCallEvidence, listingFor,
  HOUSE_COLUMNS, type HouseRow,
} from '../lib/refurb-read.js';
import { estimate, builderBrief } from '../../src/features/crm/lib/refurbCard.js';
import {
  blankAreas, pricedWorks, worksToConfirm, toInspect, verdictOf, sizeCandidates,
  type AreaAssessment,
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

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

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
      // Before any reading has run there are still two places a size can be:
      // Rightmove's own field and the advert text. The plan needs a model.
      sizes: sizeCandidates({
        listingSqm: listing?.floorAreaSqm ?? h.floor_area_sqm ?? null,
        textSqm: listing?.textFloorArea ?? null,
        reads: (stored?.analysis_meta?.floorAreas as never) ?? [],
      }),
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
  //
  // THE READING LIVES IN api/lib/refurb-read.ts, not here, because there are two
  // doors into it: this button, and the sweep that reads a house the moment a
  // viewing is booked for it (api/cron/refurb-read.ts).
  if (action !== 'analyse') return Response.json({ error: 'Unknown action' }, { status: 400 });

  const out = await readProperty(sb, h, {
    areas: Array.isArray(body.areas) ? body.areas : undefined,
    refresh: Boolean(body.refresh),
    by: who.id,
  });
  if (!out.ok) return Response.json({ error: out.error }, { status: 502 });

  return Response.json({
    ok: true,
    areas: out.areas,
    analysisMeta: out.meta,
    analysedAt: new Date().toISOString(),
    listing: out.listing,
    sizes: out.sizes,
  });
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
