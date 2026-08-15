// The ballpark, fetched on one button after call one.
//
// Hugo, 2026-08-15: "after the first call I should go and analyze myself and
// then have a button to fetch the ballpark ... the system hears the call, sees
// what the agent said, and then the spreadsheet mathematics from the course
// ... and then we have the solid ballpark for a callback."
//
// WHAT THIS DOES, in order:
//   1. HEARS THE CALL. Loads the live transcript of the latest property call
//      to this branch, plus whatever Pedro typed into the checklist.
//   2. EXTRACTS THE FACTS with a model: condition band, specific works, the
//      floor area if the agent stated one. Language work only. If the call
//      did not establish the condition, the answer is unknown, never a guess.
//   3. ASKS THE ENGINE. POSTs the facts to the scraper's /api/reprice, which
//      runs the course arithmetic (per-sqm comps, rate-card refurb at the low
//      end, TMV = GDV minus works and 5%, open at 0.75, ceiling at 0.80).
//      THE MONEY IS COMPUTED THERE AND NOWHERE ELSE. This file never does
//      arithmetic on a figure; it carries the engine's answer.
//   4. Returns a PREVIEW: what was heard (with the agent's words), the band,
//      the evidence. Nothing is written until Hugo confirms.
//   5. On apply, ARMS CALL TWO: writes the band onto the branch card in the
//      same keys the priced assign script uses, sets the step to 'Offer call'
//      (this is the only writer of that step, on purpose: a card only reaches
//      offer mode through a confirmed ballpark), moves the board card to
//      'Ready for call 2', and rewrites the brief.
//
// A refusal from the engine (condition unknown, derelict needs a builder,
// comps below standard) comes back as a plain answer, not an error: the
// refusal IS the homework result, and it tells Hugo what is missing.

import { createClient } from '@supabase/supabase-js';
import { callLLM } from '../lib/llm.js';
import { buildNextStepBrief } from '../lib/next-step-brief.js';

export const config = { runtime: 'edge' };

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const MODEL = 'claude-sonnet-5';
const ENGINE_URL = process.env.SCRAPER_REPRICE_URL || 'https://scraper.heyelsie.com/api/reprice';

// The rate card's whole vocabulary. Anything else the model might say is not
// priceable and must not be invented into the survey.
const BANDS = ['turnkey', 'cosmetic', 'modernisation', 'full_refurb', 'derelict', 'unknown'];
const WORKS = ['kitchen', 'bathroom', 'rewire', 'replaster', 'boiler', 'flooring', 'garden',
  'full_strip_out', 'roof', 'windows', 'damp', 'structural'];

const SYSTEM_EXTRACT = [
  'You read the transcript of a phone call between our caller and a UK estate agent about one house, plus the caller\'s typed notes, and you extract ONLY what the agent actually said about the property\'s condition and size.',
  '',
  'HARD RULES.',
  '1. NEVER guess. If the agent did not establish something, it is unknown or absent. An unpriced unknown is safe; a guessed answer costs real money on a real offer.',
  `2. condition_band is exactly one of: ${BANDS.join(', ')}. turnkey = walk-in ready. cosmetic = decoration and carpets. modernisation = dated kitchen or bathroom, needs bringing up to date. full_refurb = everything needs doing. derelict = a shell, uninhabitable. unknown = the call did not establish it.`,
  `3. works_needed lists only works the agent CONFIRMED, from exactly this vocabulary: ${WORKS.join(', ')}. An agent saying the boiler is old means boiler. An agent saying the roof leaks or there is staining on ceilings means roof or damp. Say nothing the agent did not.`,
  '4. floor_area_sqm only if the agent stated a size on the call (convert sq ft to sq m by multiplying by 0.0929). Otherwise null.',
  '4b. rent_pcm only if the agent stated what the house would let for, per calendar month, in pounds. A weekly figure times 52 over 12. Otherwise null.',
  '5. heard: up to 6 short verbatim quotes from the AGENT that justify what you extracted, so a human can check every fact against the agent\'s own words.',
  '6. Long dashes, curly quotes and ellipsis characters are forbidden in your output.',
  '',
  'Return ONLY a JSON object, no prose, no code fences:',
  '{"condition_band": "...", "works_needed": [...], "flags": [], "floor_area_sqm": null, "rent_pcm": null, "heard": ["..."]}',
].join('\n');

const money = (n?: number | null) =>
  typeof n === 'number' && Number.isFinite(n) ? `£${Math.round(n).toLocaleString('en-GB')}` : '';

interface Extraction {
  condition_band: string;
  works_needed: string[];
  flags: string[];
  floor_area_sqm: number | null;
  rent_pcm: number | null;
  heard: string[];
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return Response.json({ error: 'POST only' }, { status: 405 });

  // Same door as the Deal Manager: a signed-in CRM agent or admin.
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: userResp } = await supabase.auth.getUser(jwt);
  if (!userResp?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const caller = createClient(
    process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: allowed } = await caller.rpc('wk_is_agent_or_admin');
  if (!allowed) return Response.json({ error: 'CRM access required' }, { status: 403 });

  let body: { propertyId?: string; apply?: boolean };
  try { body = await req.json() as { propertyId?: string; apply?: boolean }; }
  catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
  if (!body.propertyId) return Response.json({ error: 'propertyId required' }, { status: 400 });

  // ---- the house -------------------------------------------------------
  // The board hands over the brrr row's own id (that is what wk_property_links
  // projects as property_id); the ENGINE speaks Rightmove ids, which live in
  // source_property_id. Mixing those two up was the launch-day "unknown
  // property" bug: the route asked brrr_properties for a column it does not
  // even have.
  const { data: props } = await supabase
    .from('brrr_properties')
    .select('id, source_property_id, address, asking_price, price_text, bedrooms, property_type,'
      + ' floor_area_sqm, agent_name, status, qualification, deal, brief, pinned_note, wk_contact_id')
    .eq('id', body.propertyId)
    .limit(1);
  const prop = props?.[0];
  if (!prop) return Response.json({ error: 'unknown property' }, { status: 404 });
  if (!prop.source_property_id) {
    return Response.json({
      ok: false,
      reason: 'no_engine_id',
      detail: 'This property has no engine id on file, so the engine cannot price it.',
    }, { status: 200 });
  }

  // ---- hear the call ---------------------------------------------------
  // Newest outbound call to this branch that actually has a transcript: the
  // one where nobody picked up teaches nothing.
  let transcript = '';
  let heardCallId: string | null = null;
  if (prop.wk_contact_id) {
    const { data: calls } = await supabase
      .from('wk_calls')
      .select('id, started_at')
      .eq('contact_id', prop.wk_contact_id)
      .eq('direction', 'outbound')
      .order('started_at', { ascending: false })
      .limit(5);
    for (const c of calls ?? []) {
      const { data: lines } = await supabase
        .from('wk_live_transcripts')
        .select('speaker, body, ts')
        .eq('call_id', c.id)
        .order('ts', { ascending: true })
        .limit(300);
      const text = (lines ?? [])
        .map((r: { speaker?: string | null; body?: string | null }) =>
          `${(r.speaker ?? 'other').toUpperCase()}: ${(r.body ?? '').trim()}`)
        .filter((l) => l.length > 8)
        .join('\n')
        .slice(0, 14_000);
      if (text.length > 200) { transcript = text; heardCallId = c.id; break; }
    }
  }

  const qual = (prop.qualification ?? {}) as Record<string, unknown>;
  const typedNotes = ['condition_notes', 'water', 'notes', 'best_price_indicated']
    .map((k) => (qual[k] ? `${k}: ${String(qual[k])}` : ''))
    .filter(Boolean)
    .join('\n');

  if (!transcript && !typedNotes) {
    return Response.json({
      ok: false,
      reason: 'nothing_heard',
      detail: 'No transcript and no typed checklist answers for this branch yet. The ballpark is built from what the agent said on call one, so there is nothing to build it from.',
    }, { status: 422 });
  }

  // ---- extract the facts ----------------------------------------------
  const user = [
    `THE HOUSE: ${prop.address ?? 'unknown address'}, ${prop.bedrooms ?? '?'} bed ${prop.property_type ?? ''}.`,
    '',
    transcript ? `THE CALL:\n${transcript}` : 'There is no transcript. Work from the typed notes only.',
    '',
    typedNotes ? `THE CALLER'S TYPED NOTES:\n${typedNotes}` : '',
  ].join('\n');

  // 1600, not 900: a long call plus six quotes overran the first cap, the
  // JSON came back truncated, and the parse failure read as a mystery error.
  const raw = await callLLM(MODEL, SYSTEM_EXTRACT, [{ role: 'user', content: user }], 1600);
  if (!raw) return Response.json({ error: 'The reader did not answer. Try again.' }, { status: 502 });

  let heard: Extraction;
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(m ? m[0] : raw) as Partial<Extraction>;
    heard = {
      condition_band: BANDS.includes(String(parsed.condition_band)) ? String(parsed.condition_band) : 'unknown',
      works_needed: (parsed.works_needed ?? []).map(String).filter((w) => WORKS.includes(w)),
      flags: (parsed.flags ?? []).map(String),
      floor_area_sqm: typeof parsed.floor_area_sqm === 'number' && parsed.floor_area_sqm > 10
        ? parsed.floor_area_sqm : null,
      rent_pcm: typeof parsed.rent_pcm === 'number' && parsed.rent_pcm >= 200 && parsed.rent_pcm <= 5000
        ? Math.round(parsed.rent_pcm) : null,
      heard: (parsed.heard ?? []).map(String).slice(0, 6),
    };
  } catch {
    console.warn('[fetch-ballpark] unparseable extraction:', raw.slice(0, 400));
    return Response.json({ error: 'Could not read the extraction. Try again.' }, { status: 502 });
  }

  // ---- ask the engine --------------------------------------------------
  const secret = process.env.PROPERTY_INGEST_SECRET;
  if (!secret) return Response.json({ error: 'PROPERTY_INGEST_SECRET is not set' }, { status: 500 });

  let engine: Record<string, unknown>;
  try {
    const res = await fetch(ENGINE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ingest-secret': secret },
      body: JSON.stringify({
        property_id: prop.source_property_id,
        survey: {
          condition_band: heard.condition_band === 'unknown' ? '' : heard.condition_band,
          works_needed: heard.works_needed,
          flags: heard.flags,
        },
        floor_area_sqm: heard.floor_area_sqm,
        rent_pcm: heard.rent_pcm,
      }),
    });
    engine = await res.json() as Record<string, unknown>;
  } catch (e) {
    return Response.json({ error: `Could not reach the engine: ${String(e).slice(0, 120)}` }, { status: 502 });
  }

  // The engine may have priced the condition from the LISTING PHOTOS (its
  // own high-confidence eye read, the same evidence every nightly priced
  // deal ships on) when the call never established it. Reflect that back so
  // the preview says where the band came from.
  if (engine.ok && engine.condition_source === 'listing_photos') {
    heard.condition_band = String(engine.refurb_band ?? heard.condition_band);
  }

  // A refusal is the homework's honest answer, passed through with the facts
  // so Hugo can see WHY (condition unknown, needs a builder, comps below
  // standard) next to what the agent actually said.
  if (!engine.ok) {
    return Response.json({ ok: false, heard, engine, heardCallId }, { status: 200 });
  }

  if (!body.apply) {
    return Response.json({ ok: true, applied: false, heard, engine, heardCallId }, { status: 200 });
  }

  // ---- arm call two ----------------------------------------------------
  const open = Number(engine.open);
  const ceiling = Number(engine.ceiling);
  const ladder = (engine.ladder as number[] | undefined) ?? [];
  const nowIso = new Date().toISOString();

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
    offer: { min: open, max: ceiling, ladder },
    reprice: { ...engine, heard, at: nowIso, call_id: heardCallId },
  };

  const brief = buildNextStepBrief({
    property: { ...prop, deal: newDeal },
    outcome: 'qualified',
    qualification: mergedQual,
    step: 'Offer call',
    board: 'Ready for call 2',
    contactEmail: null,
    now: new Date(),
  });

  await supabase
    .from('brrr_properties')
    .update({ qualification: mergedQual, deal: newDeal, brief, updated_at: nowIso })
    .eq('id', prop.id);

  if (prop.wk_contact_id) {
    const { data: contact } = await supabase
      .from('wk_contacts')
      .select('id, email, custom_fields')
      .eq('id', prop.wk_contact_id)
      .maybeSingle();
    const evidence = ((engine.evidence as Array<Record<string, unknown>> | undefined) ?? [])
      .slice(0, 3)
      .map((c) => `${String(c.address ?? '').split(',')[0]} went for ${money(Number(c.price))} (${String(c.date ?? '')}, ${c.distance_m ?? '?'}m away)`)
      .join('; ');
    const fields = {
      ...((contact?.custom_fields ?? {}) as Record<string, string>),
      offer_open: money(open),
      offer_ceiling: money(ceiling),
      offer_ladder: ladder.length > 1 ? ladder.map(money).join(', then ') : `${money(open)}, up to ${money(ceiling)}`,
      property_worth: `${money(Number(engine.gdv))} done up (${String(engine.comps_tier)} comps, ${String(engine.comps_used)} sold nearby)`,
      comp_evidence: evidence || 'see the deal drawer',
      valuation_notes: `Ballpark confirmed ${nowIso.slice(0, 10)} from call one: condition ${heard.condition_band}, refurb ${money(Number(engine.refurb))} at the low end, ${String(engine.comps_tier)} evidence.`,
      next_step: 'Offer call',
    };
    await supabase.from('wk_contacts').update({ custom_fields: fields }).eq('id', prop.wk_contact_id);

    // The board move. The column is looked up by name and skipped in silence
    // if this board does not have one: the band on the card is the point, the
    // column is presentation.
    const { data: col } = await supabase
      .from('wk_pipeline_columns')
      .select('id')
      .eq('name', 'Ready for call 2')
      .maybeSingle();
    if (col?.id) {
      await supabase.from('wk_contacts').update({ pipeline_column_id: col.id }).eq('id', prop.wk_contact_id);
    }
  }

  return Response.json({ ok: true, applied: true, heard, engine, heardCallId }, { status: 200 });
}
