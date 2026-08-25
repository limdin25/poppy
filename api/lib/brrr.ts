// BRRR property qualifier — shared helpers for ingest, the dial cron and the
// Retell webhook branch. Properties live in brrr_properties (admin-only, no RLS);
// qualified ones become deals in Hugo's live business pipeline.
import { createClient } from '@supabase/supabase-js';
import { notifyBusinessOwner } from './notify.js';
import { offerRange, fmtGBP } from './brrr-offer.js';
import { firstText } from './anthropic-content.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;

export const PIPELINE_BUSINESS_ID = process.env.PROPERTY_PIPELINE_BUSINESS_ID || '';

// ── Adjustable rules (admin → Properties → Settings) ─────────────────────────
export interface BrrrSettings {
  auto_queue_on_ingest: boolean; // "Send to Elsie" = cleared to call
  max_attempts: number;          // tries before giving up (no answer)
  retry_hours: number;           // gap between attempts
  max_dials_per_run: number;     // per cron tick (every 2 min)
  call_days: string[];           // e.g. ['Mon','Tue','Wed','Thu','Fri','Sat']
  call_start: string;            // 'HH:MM' Europe/London
  call_end: string;              // 'HH:MM' Europe/London
  offer_low_pct: number;         // AI's opening figure, % of asking price
  offer_high_pct: number;        // AI's ceiling, % of asking (capped by the deal calculator's offer)
}

export const DEFAULT_BRRR_SETTINGS: BrrrSettings = {
  auto_queue_on_ingest: true,
  max_attempts: 3,
  retry_hours: 2,
  max_dials_per_run: 2,
  call_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  call_start: '09:30',
  call_end: '17:00',
  offer_low_pct: 70,
  offer_high_pct: 75,
};

export async function getBrrrSettings(): Promise<BrrrSettings> {
  const { data } = await supabase
    .from('platform_settings')
    .select('value')
    .eq('key', 'brrr_settings')
    .maybeSingle();
  if (!data?.value) return { ...DEFAULT_BRRR_SETTINGS };
  try {
    return { ...DEFAULT_BRRR_SETTINGS, ...JSON.parse(data.value) };
  } catch {
    return { ...DEFAULT_BRRR_SETTINGS };
  }
}

export async function saveBrrrSettings(patch: Partial<BrrrSettings>): Promise<BrrrSettings> {
  const merged = { ...(await getBrrrSettings()), ...patch };
  await supabase
    .from('platform_settings')
    .upsert({ key: 'brrr_settings', value: JSON.stringify(merged), updated_at: new Date().toISOString() });
  return merged;
}

/** The offer band, the money formatter and the negotiation ladder now live in
 *  ./brrr-offer.ts — a pure module with no createClient() at import time, so
 *  the dialer's browser code can import the SAME maths instead of keeping its
 *  own copy. Re-exported here so every existing importer of this file is
 *  unchanged. See that file for why the offer is never a % of GDV. */
export { offerRange, fmtGBP, gbpShort, ladderText } from './brrr-offer.js';
export type { OfferPercents, OfferSubject } from './brrr-offer.js';

export interface BrrrProperty {
  id: string;
  source: string;
  source_property_id: string;
  listing_url: string | null;
  address: string | null;
  price_text: string | null;
  asking_price: number | null;
  bedrooms: number | null;
  property_type: string | null;
  days_on_market: string | null;
  agent_name: string | null;
  agent_phone: string | null;
  deal: Record<string, unknown>;
  status: string;
  deal_id: string | null;
}

/** UK numbers from the scraper look like "0121 456 7890" — normalise to E.164. */
export function toE164(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, '');
  if (!digits) return null;
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (digits.startsWith('0')) return `+44${digits.slice(1)}`;
  if (digits.startsWith('44')) return `+${digits}`;
  return `+44${digits}`;
}


export interface Qualification {
  // 'figure_obtained' is the human path only, added 2026-08-10 when Pedro
  // started negotiating on the call himself: the agent has told him a number
  // that would get it done and the deal is now waiting on the director, which
  // is a different thing from "qualified" (worth pursuing) and from "callback"
  // (nothing learned). The retired AI extractor never emits it, so its prompt
  // below is deliberately left alone.
  // 'deciding' and 'follow_up' joined 2026-08-11 at Hugo's request: a branch
  // that has our interest and is thinking it over, and one that simply needs
  // ringing again. Both are warm tracking states he watches on the board, not
  // deals for the director, so neither is a PIPELINE_OUTCOME. The retired AI
  // extractor never emits any of these.
  outcome?: 'qualified' | 'figure_obtained' | 'deciding' | 'follow_up' | 'not_qualified' | 'callback' | 'no_answer';
  next_step?: 'book_viewing' | 'make_offer' | 'monitor_backup' | 'call_back' | 'awaiting_director' | 'none' | null;
  still_available?: boolean | null;
  occupancy?: string | null;            // vacant / tenanted (+ tenancy details)
  condition_notes?: string | null;
  /** THE HOUSE NUMBER, asked on every call from 2026-08-25 (Hugo: "you need to
   *  get the house number").
   *
   *  Rightmove publishes no house number on 96.6% of adverts, so
   *  brrr_properties.address is a street and a postcode and a builder cannot be
   *  sent to it. It already cost a real viewing: the Lunar Builders invite on
   *  21 August said "Oundle Road, Kingstanding, Birmingham B44 8EP", Shakeel
   *  asked for the full address within the minute, nobody answered for 41 hours
   *  and he cancelled on the morning.
   *
   *  Pedro types the number alone ("10"). property-outcome.ts composes it onto
   *  the street with addressFromAnswer, the SAME function the builder brain
   *  uses on a WhatsApp answer, and writes brrr_properties.viewing_address,
   *  never `address`. */
  house_number?: string | null;
  // The four below arrived 2026-08-15 with the house-aware checklist. The
  // script had asked about water and size since 8b and the answers had
  // NOWHERE TO LIVE except free text; rent decides the investor's 20% ROI at
  // the ballpark; the rejected offer is the course's single best question
  // (the Harvey call: "the last offer that they rejected though was 175").
  water?: string | null;                // dry? leaks, ceiling staining, roof
  floor_area?: string | null;           // sqm the AGENT stated, when the machine has none
  rent_estimate?: string | null;        // "what would it let for" pcm
  rejected_offer?: string | null;       // any offer rejected, and at what level
  // Added 2026-08-15. The script has asked this since 8b and calls it "the most
  // valuable question on this page", the coach prompts for it, and the
  // confidence scorer names its absence as the thing holding a deal back. It
  // had no field, so the answer went in the free-text note and nothing ever
  // read it. A done-up sale on the subject's own street beats every comparable
  // we can assemble at a desk, because it is the same street, the same stock
  // and a finished condition, which is exactly what the Land Registry cannot
  // tell us. Free text on purpose: Pedro types what he heard ("number 12 went
  // for 118 in the spring"), and the ballpark extracts the figure from it.
  agent_comparable?: string | null;     // done-up sale the AGENT quoted: address, price, when
  why_selling?: string | null;
  motivation?: string | null;           // how motivated/urgent the vendor is
  chain?: string | null;
  fallen_through?: string | null;       // has a sale fallen through before
  tenure?: string | null;
  lease_years?: string | null;
  service_charge?: string | null;
  ground_rent?: string | null;
  major_works?: string | null;          // planned works / big bills / cladding-EWS1 (flats)
  interest_level?: string | null;       // viewings/offers so far
  offer_reaction?: string | null;
  best_price_indicated?: string | null; // any figure the AGENT hinted would get it done
  viewing_availability?: string | null; // now "is a builder visit easy to arrange", we never view
  video_walkthrough?: string | null;    // did we ask for one, and did they send it
  branch_contact_name?: string | null;  // who we spoke to, so the next call asks for them by name
  summary?: string | null;
  action_required?: string | null;
}

/** Question checklist — single source for the extraction prompt and the
 *  admin UI's asked/answered view. */
export const QUALIFICATION_QUESTIONS: Array<{ key: keyof Qualification; question: string }> = [
  { key: 'still_available', question: 'Is the property still available?' },
  { key: 'occupancy', question: 'Vacant or tenanted? (tenancy details if tenanted)' },
  { key: 'condition_notes', question: 'What condition is it in / what works are needed?' },
  { key: 'water', question: 'Is it dry? Any leaks, ceiling staining, roof trouble?' },
  { key: 'house_number', question: 'House number, so the builder can find the door' },
  { key: 'floor_area', question: 'Floor area in sqm, if the agent has the particulars' },
  { key: 'rent_estimate', question: 'What would it let for, per month?' },
  { key: 'agent_comparable', question: 'Anything on that street sold recently that was done up, and what did it go for?' },
  { key: 'rejected_offer', question: 'Has any offer been rejected, and at what level?' },
  { key: 'interest_level', question: 'How much interest — viewings / offers so far?' },
  { key: 'fallen_through', question: 'Has a sale ever fallen through on it?' },
  { key: 'why_selling', question: 'Why is the vendor selling?' },
  { key: 'motivation', question: 'How motivated / urgent is the vendor?' },
  { key: 'chain', question: 'Is there an onward chain?' },
  { key: 'tenure', question: 'Freehold or leasehold?' },
  { key: 'lease_years', question: 'Years remaining on the lease? (flats)' },
  { key: 'service_charge', question: 'Service charge? (flats)' },
  { key: 'ground_rent', question: 'Ground rent? (flats)' },
  { key: 'major_works', question: 'Major works planned / cladding issues? (flats)' },
  { key: 'offer_reaction', question: 'How did the offer feeler land?' },
  { key: 'best_price_indicated', question: 'What figure did the agent hint would get it done?' },
  // We never view a property ourselves: the builder does, and prices the refurb
  // while he is there. So the question is whether we got the video that lets him
  // quote without anybody driving to Sheffield.
  { key: 'video_walkthrough', question: 'Did we ask for a video walkthrough, and did they agree?' },
  { key: 'branch_contact_name', question: 'Who did we speak to at the branch?' },
  { key: 'viewing_availability', question: 'Is a builder visit easy to arrange with them?' },
];

/** Extract a structured qualification from the call transcript via Claude. */
export async function extractQualification(
  transcript: string,
  property: BrrrProperty,
  settings?: BrrrSettings,
): Promise<Qualification> {
  const s = settings || await getBrrrSettings();
  const { min, max } = offerRange(property, s);
  const band = `${fmtGBP(min)}–${fmtGBP(max)}`;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `An AI assistant called the estate agent about ${property.address} (asking ${property.price_text}, our offer band ${band} — the AI opens low and climbs, never revealing the top) to qualify it for a buy-refurbish-refinance purchase. Analyse the transcript and return JSON only. Every field is null when the question was not asked or not answered — do NOT guess:
{
  "outcome": "qualified" | "not_qualified" | "callback",
  "next_step": "book_viewing" | "make_offer" | "monitor_backup" | "call_back" | "none",
  "still_available": boolean or null,
  "occupancy": string or null (vacant or tenanted; tenancy details if mentioned),
  "condition_notes": string or null,
  "why_selling": string or null,
  "motivation": string or null (how motivated/urgent the vendor sounds),
  "chain": string or null,
  "fallen_through": string or null (has a previous sale fallen through),
  "tenure": string or null (freehold/leasehold),
  "lease_years": string or null,
  "service_charge": string or null,
  "ground_rent": string or null,
  "major_works": string or null (planned works, big one-off bills, cladding/EWS1 issues),
  "interest_level": string or null (viewings/offers so far),
  "offer_reaction": string or null (exact reaction to the offer feeler),
  "best_price_indicated": string or null (any figure the AGENT suggested would get it done),
  "viewing_availability": string or null (days/times/notice for viewings),
  "summary": string (3-4 sentences),
  "action_required": string or null
}

"qualified" = still available AND the agent did not rule out an offer in the ${band} band (open, "put it forward", "worth trying", vendor flexible).
"not_qualified" = sold/under offer/withdrawn, or the agent clearly said an offer at that level has no chance, or a deal-breaker came up (e.g. very short lease, cladding remediation with no protections, structural issues beyond a £10k refurb).
"callback" = couldn't get answers (wrong person, asked to call back, agent needs to check with vendor).

"next_step" = the single most useful follow-up action:
- "book_viewing": qualified and the agent recommended/expects a viewing before offers go in.
- "make_offer": qualified and the agent invited an offer directly (no viewing needed first).
- "monitor_backup": sold/under offer BUT worth registering as a cash backup buyer (agent open to it or sale not yet exchanged).
- "call_back": the agency needs calling again — call dropped, wrong person answered, or the agent must check with the vendor first.
- "none": dead end, nothing useful to do.

Transcript:
${transcript}`,
      }],
    }),
  });
  const data = await res.json() as { content?: Array<{ text?: string }> };
  const text = firstText(data.content);
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  return jsonMatch ? JSON.parse(jsonMatch[0]) : {};
}

/** Queue an outbound qualification call (skips if one is already pending/dialing). */
export async function queuePropertyCall(
  propertyId: string,
): Promise<{ ok: boolean; queued: boolean; error?: string }> {
  const { data: open } = await supabase
    .from('brrr_property_calls')
    .select('id')
    .eq('property_id', propertyId)
    .in('status', ['pending', 'dialing'])
    .limit(1)
    .maybeSingle();
  if (open) return { ok: true, queued: false };

  const { error } = await supabase
    .from('brrr_property_calls')
    .insert({ property_id: propertyId, status: 'pending', next_attempt_at: new Date().toISOString() });
  if (error) return { ok: false, queued: false, error: error.message };

  await supabase
    .from('brrr_properties')
    .update({ status: 'call_queued', updated_at: new Date().toISOString() })
    .eq('id', propertyId);
  return { ok: true, queued: true };
}

/**
 * Push a qualified property into Hugo's live pipeline: estate agent becomes a
 * contact, the property becomes a deal in the "Qualified" stage (created if
 * missing). Idempotent — skips if the property already has a deal.
 */
export async function pushPropertyToPipeline(
  property: BrrrProperty,
  qualification?: Qualification,
): Promise<{ ok: boolean; dealId?: string; error?: string }> {
  if (!PIPELINE_BUSINESS_ID) return { ok: false, error: 'PROPERTY_PIPELINE_BUSINESS_ID not set' };

  // Estate agent as contact (find by phone, else create) — skipped when the
  // property already has a deal (we'll move that deal rather than create one).
  let contactId: string | null = null;
  const phone = toE164(property.agent_phone);
  if (!property.deal_id && phone) {
    const { data: existing } = await supabase
      .from('contacts')
      .select('id')
      .eq('business_id', PIPELINE_BUSINESS_ID)
      .eq('phone', phone)
      .maybeSingle();
    if (existing) {
      contactId = existing.id;
    } else {
      const { data: created } = await supabase
        .from('contacts')
        .insert({
          business_id: PIPELINE_BUSINESS_ID,
          phone,
          name: property.agent_name || 'Estate agent',
          status: 'qualified',
        })
        .select('id')
        .single();
      contactId = created?.id || null;
    }
  }

  // Stage by the call's next step: a figure out of the agent waits in
  // "Awaiting director", viewing-first deals go straight to a "Viewing" column,
  // sale-agreed backups to "Monitoring", the rest to "Qualified". Stages are
  // created on first use.
  //
  // "Awaiting director" exists because the call flow changed on 2026-08-10:
  // Pedro now negotiates on the phone, so the common end state is "they said
  // £X, it is on Hugo now". Filing that as plain "Qualified" hid the one thing
  // Hugo has to act on, in the same column as deals nobody is waiting on. It
  // sorts FIRST for that reason.
  const STAGE_BY_NEXT_STEP: Record<string, { name: string; color: string; sort_order: number }> = {
    awaiting_director: { name: 'Awaiting director', color: 'amber', sort_order: 1 },
    book_viewing: { name: 'Viewing', color: 'sky', sort_order: 3 },
    monitor_backup: { name: 'Monitoring', color: 'slate', sort_order: 7 },
  };
  // monitor_backup only makes sense for sale-agreed (not_qualified) properties —
  // a contradictory LLM output must not file a qualified deal under Monitoring.
  const nextStep = qualification?.next_step === 'monitor_backup' && qualification?.outcome !== 'not_qualified'
    ? null
    : qualification?.next_step;
  const target = STAGE_BY_NEXT_STEP[nextStep || '']
    || { name: 'Qualified', color: 'emerald', sort_order: 2 };

  let stageId: string | null = null;
  const { data: stage } = await supabase
    .from('pipeline_stages')
    .select('id')
    .eq('business_id', PIPELINE_BUSINESS_ID)
    .ilike('name', target.name)
    .maybeSingle();
  if (stage) {
    stageId = stage.id;
  } else {
    const { data: created } = await supabase
      .from('pipeline_stages')
      .insert({ business_id: PIPELINE_BUSINESS_ID, name: target.name, color: target.color, sort_order: target.sort_order })
      .select('id')
      .single();
    stageId = created?.id || null;
  }

  const deal = (property.deal || {}) as Record<string, unknown>;
  const q = qualification || {};
  const lines = [
    nextStep === 'monitor_backup'
      ? `Sale agreed elsewhere — tracked as cash backup by Elsie.`
      : nextStep === 'awaiting_director'
        ? `Figure obtained on the phone. Waiting on the director to decide.`
        : `BRRR property qualified by Elsie.`,
    property.listing_url ? `Listing: ${property.listing_url}` : null,
    `Asking: ${property.price_text || fmtGBP(property.asking_price)} · Offer target: ${fmtGBP(deal.offer_price)} · GDV: ${fmtGBP(deal.gdv)}`,
    deal.rent ? `Target rent: ${fmtGBP(deal.rent)}/mo · Cash needed: ${fmtGBP(deal.total_cash)}` : null,
    property.agent_name ? `Agent: ${property.agent_name} ${property.agent_phone || ''}` : null,
    q.summary ? `\nCall summary: ${q.summary}` : null,
    q.occupancy ? `Occupancy: ${q.occupancy}` : null,
    q.condition_notes ? `Condition: ${q.condition_notes}` : null,
    q.why_selling || q.motivation ? `Motivation: ${[q.why_selling, q.motivation].filter(Boolean).join(' — ')}` : null,
    q.chain ? `Chain: ${q.chain}` : null,
    [q.tenure, q.lease_years && `${q.lease_years} on lease`, q.service_charge && `SC ${q.service_charge}`, q.ground_rent && `GR ${q.ground_rent}`].filter(Boolean).length
      ? `Tenure: ${[q.tenure, q.lease_years && `${q.lease_years} on lease`, q.service_charge && `SC ${q.service_charge}`, q.ground_rent && `GR ${q.ground_rent}`].filter(Boolean).join(' · ')}` : null,
    q.offer_reaction ? `Offer reaction: ${q.offer_reaction}` : null,
    q.best_price_indicated ? `Agent hinted: ${q.best_price_indicated}` : null,
    q.viewing_availability ? `Viewings: ${q.viewing_availability}` : null,
  ].filter(Boolean);

  const offerValue = typeof deal.offer_price === 'number'
    ? deal.offer_price
    : parseFloat(String(deal.offer_price || '')) || property.asking_price || 0;

  // Property already in the pipeline (e.g. a Monitoring backup whose sale fell
  // through and has now re-qualified): move the existing deal to the right
  // stage and refresh its details rather than stranding it.
  if (property.deal_id) {
    await supabase
      .from('deals')
      .update({ stage_id: stageId, description: lines.join('\n'), value: offerValue })
      .eq('id', property.deal_id);
    return { ok: true, dealId: property.deal_id };
  }

  const { data: createdDeal, error } = await supabase
    .from('deals')
    .insert({
      business_id: PIPELINE_BUSINESS_ID,
      stage_id: stageId,
      contact_id: contactId,
      title: property.address || `Rightmove ${property.source_property_id}`,
      description: lines.join('\n'),
      value: offerValue,
      currency: 'GBP',
    })
    .select('id')
    .single();

  if (error || !createdDeal) return { ok: false, error: error?.message || 'deal insert failed' };

  await supabase
    .from('brrr_properties')
    .update({ deal_id: createdDeal.id, updated_at: new Date().toISOString() })
    .eq('id', property.id);

  return { ok: true, dealId: createdDeal.id };
}

/**
 * Webhook handler for the property-qualifier agent's calls. Branched out of
 * api/webhooks/retell.ts BEFORE the inbound flow — these calls have no
 * business/agent mapping and must not create contacts/conversations there.
 */
export async function handleBrrrCallEvent(
  event: string,
  call: Record<string, any>,
): Promise<Record<string, unknown>> {
  const meta = (call.metadata || {}) as Record<string, any>;

  let callRow: Record<string, any> | null = null;
  if (meta.property_call_id) {
    const { data } = await supabase
      .from('brrr_property_calls')
      .select('*')
      .eq('id', meta.property_call_id)
      .maybeSingle();
    callRow = data;
  }
  if (!callRow && call.call_id) {
    const { data } = await supabase
      .from('brrr_property_calls')
      .select('*')
      .eq('retell_call_id', call.call_id)
      .maybeSingle();
    callRow = data;
  }
  if (!callRow) return { ok: false, reason: 'no matching property call' };

  // A retried row gets a fresh retell_call_id on each dial (the cron nulls it
  // during the claim window) — only the event whose call_id matches the row's
  // CURRENT dial may touch it. Null/mismatch means stale or mid-redial.
  if (!callRow.retell_call_id || !call.call_id || callRow.retell_call_id !== call.call_id) {
    return { ok: true, skipped: 'event is not for the row\'s current dial' };
  }

  const { data: property } = await supabase
    .from('brrr_properties')
    .select('*')
    .eq('id', callRow.property_id)
    .single();
  if (!property) return { ok: false, reason: 'property missing' };

  if (event === 'call_analyzed') {
    const analysis = call.call_analysis || {};
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (analysis.call_summary && !callRow.summary) update.summary = analysis.call_summary;
    // Final cost arrives with the analysis event (Retell combined cost, cents)
    const cents = call.call_cost?.combined_cost;
    if (typeof cents === 'number') update.cost_usd = Math.round(cents) / 100;
    await supabase.from('brrr_property_calls').update(update).eq('id', callRow.id);
    return { ok: true };
  }

  // call_ended — atomic claim: Retell redelivers webhooks on timeout, and two
  // invocations racing through extraction + pipeline-push created a duplicate
  // deal once. Only the invocation that flips dialing→completed processes.
  const { data: claimed } = await supabase
    .from('brrr_property_calls')
    .update({ status: 'completed', updated_at: new Date().toISOString() })
    .eq('id', callRow.id)
    .eq('status', 'dialing')
    .select('id');
  if (!claimed || claimed.length === 0) {
    return { ok: true, skipped: 'call_ended already processed' };
  }

  const transcriptForUI = (call.transcript_object || []).map((t: any) => ({
    speaker: t.role === 'user' ? 'caller' : 'agent',
    text: t.content,
  }));
  const answered = (call.transcript_object || []).some(
    (t: any) => t.role === 'user' && ((t.content as string) || '').trim().length > 0,
  );
  const nowIso = new Date().toISOString();

  const settings = await getBrrrSettings();

  if (!answered) {
    const attempts = callRow.attempts || 1;
    if (attempts >= settings.max_attempts) {
      await supabase.from('brrr_property_calls').update({
        status: 'no_answer',
        summary: `No answer after ${attempts} attempts.`,
        recording_url: call.recording_url || null,
        updated_at: nowIso,
      }).eq('id', callRow.id);
      await supabase.from('brrr_properties')
        .update({ status: 'no_answer', updated_at: nowIso })
        .eq('id', property.id);
    } else {
      await supabase.from('brrr_property_calls').update({
        status: 'pending',
        summary: `No answer (attempt ${attempts} of ${settings.max_attempts}) — retrying.`,
        next_attempt_at: new Date(Date.now() + settings.retry_hours * 60 * 60 * 1000).toISOString(),
        updated_at: nowIso,
      }).eq('id', callRow.id);
      await supabase.from('brrr_properties')
        .update({ status: 'call_queued', updated_at: nowIso })
        .eq('id', property.id);
    }
    return { ok: true, outcome: 'no_answer' };
  }

  return processAnsweredBrrrCall(callRow, property, {
    transcript: call.transcript || '',
    transcriptForUI,
    recordingUrl: call.recording_url || null,
    costCents: call.call_cost?.combined_cost,
  }, settings);
}

/**
 * Everything that happens after an answered qualifier call ends: Claude
 * extraction, dropped-call retry, final row/property updates, pipeline push,
 * owner notification. Shared by the webhook (call_ended) and the extraction
 * sweeper (edge timeouts can kill the webhook mid-extraction).
 */
export async function processAnsweredBrrrCall(
  callRow: Record<string, any>,
  property: Record<string, any>,
  call: {
    transcript: string;
    transcriptForUI: Array<{ speaker: string; text: string }>;
    recordingUrl: string | null;
    costCents?: number;
  },
  settings: BrrrSettings,
): Promise<Record<string, unknown>> {
  const nowIso = new Date().toISOString();
  let qualification: Qualification = {};
  let extractionFailed = false;
  try {
    qualification = await extractQualification(call.transcript || '', property as BrrrProperty, settings);
    if (!qualification.outcome) extractionFailed = true;
  } catch (e) {
    console.error('[brrr] extraction failed:', e);
    extractionFailed = true;
  }
  const outcome = qualification.outcome || 'callback';

  // A call that dropped before anything was learned (line died, IVR swallowed
  // it, agent hung up straight away) is retried like a no-answer rather than
  // parked as a dead "callback". Short gap — line glitches clear in minutes,
  // and Princess Street's qualified deal came from exactly this kind of retry.
  const INFO_KEYS: Array<keyof Qualification> = [
    'still_available', 'occupancy', 'condition_notes', 'why_selling', 'motivation',
    'chain', 'fallen_through', 'tenure', 'lease_years', 'service_charge',
    'ground_rent', 'major_works', 'interest_level', 'offer_reaction',
    'best_price_indicated', 'viewing_availability',
  ];
  const learnedNothing = !INFO_KEYS.some((k) => {
    const v = qualification[k];
    return v !== null && v !== undefined && v !== '';
  });
  // Never redial on extraction failure — the call may have been fully answered
  // and only our Claude call failed; the transcript is saved for manual review.
  const attemptsSoFar = callRow.attempts || 1;
  if (!extractionFailed && outcome === 'callback' && learnedNothing && attemptsSoFar < settings.max_attempts) {
    await supabase.from('brrr_property_calls').update({
      status: 'pending',
      transcript: call.transcriptForUI,
      recording_url: call.recordingUrl,
      summary: `Call dropped before any information was gathered (attempt ${attemptsSoFar} of ${settings.max_attempts}) — retrying shortly.`,
      qualification,
      next_attempt_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      updated_at: nowIso,
    }).eq('id', callRow.id);
    await supabase.from('brrr_properties')
      .update({ status: 'call_queued', updated_at: nowIso })
      .eq('id', property.id);
    return { ok: true, outcome: 'dropped_retry' };
  }

  await supabase.from('brrr_property_calls').update({
    status: 'completed',
    transcript: call.transcriptForUI,
    recording_url: call.recordingUrl,
    summary: qualification.summary || null,
    qualification,
    ...(typeof call.costCents === 'number' ? { cost_usd: Math.round(call.costCents) / 100 } : {}),
    updated_at: nowIso,
  }).eq('id', callRow.id);

  const statusMap: Record<string, string> = {
    qualified: 'qualified',
    not_qualified: 'not_qualified',
    callback: 'callback',
  };
  await supabase.from('brrr_properties').update({
    status: statusMap[outcome] || 'callback',
    qualification,
    updated_at: nowIso,
  }).eq('id', property.id);

  // Qualified deals go to the pipeline; sale-agreed properties worth tracking
  // as a cash backup land in the Monitoring column (no email — they're not
  // actionable today, just worth watching for a fall-through).
  if (outcome === 'not_qualified' && qualification.next_step === 'monitor_backup') {
    await pushPropertyToPipeline(property as BrrrProperty, qualification).catch((e) =>
      console.error('[brrr] monitor-backup pipeline push failed', property.id, String(e).slice(0, 200)));
  }

  if (outcome === 'qualified') {
    // LOUD. A qualified deal that never reaches the pipeline is a house
    // somebody said yes to and nobody ever saw again; `.catch(() => null)`
    // here made that invisible (16 Aug audit, silent-failure class).
    await pushPropertyToPipeline(property as BrrrProperty, qualification).catch((e) =>
      console.error('[brrr] QUALIFIED deal pipeline push FAILED', property.id, String(e).slice(0, 200)));
    if (PIPELINE_BUSINESS_ID) {
      notifyBusinessOwner(PIPELINE_BUSINESS_ID, 'call', {
        title: `Property qualified: ${property.address || property.source_property_id}`,
        body: [
          qualification.summary,
          qualification.offer_reaction ? `Offer reaction: ${qualification.offer_reaction}` : null,
          property.agent_phone ? `Agent: ${property.agent_name || ''} ${property.agent_phone}` : null,
          property.listing_url,
        ].filter(Boolean).join('\n'),
      }).catch(() => {});
    }
  }

  return { ok: true, outcome };
}

/**
 * Live transcript stream: Retell fires transcript_updated on every turn while
 * the call is in progress. We write the partial transcript onto the dialing
 * row so the admin Call Monitor can show the conversation as it happens.
 * Cheap by design — one conditional update, no extraction, no status change.
 */
export async function handleBrrrTranscriptUpdate(
  call: Record<string, any>,
): Promise<Record<string, unknown>> {
  if (!call.call_id) return { ok: false, reason: 'no call id' };

  const turns = (call.transcript_object || call.transcript_with_tool_calls || [])
    .filter((t: any) => t.role === 'user' || t.role === 'agent')
    .map((t: any) => ({
      speaker: t.role === 'user' ? 'caller' : 'agent',
      text: t.content,
    }))
    .filter((t: any) => (t.text || '').trim().length > 0);
  if (turns.length === 0) return { ok: true, skipped: 'empty transcript' };

  // Only while the row is still dialing — the call_ended handler owns the
  // final transcript, and a late update must never overwrite it.
  const { data } = await supabase
    .from('brrr_property_calls')
    .update({ transcript: turns, updated_at: new Date().toISOString() })
    .eq('retell_call_id', call.call_id)
    .eq('status', 'dialing')
    .select('id');
  return { ok: true, updated: !!data?.length };
}

/**
 * Edge timeouts can kill the webhook mid-extraction, leaving a completed call
 * with an empty qualification (3 of 19 calls in one live batch). Sweep them:
 * refetch the call from Retell and run the exact same processing the webhook
 * would have. Bounded per run; re-attempts naturally on the next cron tick.
 */
export async function sweepStuckExtractions(limit = 2): Promise<number> {
  const RETELL_API_KEY = process.env.RETELL_API_KEY;
  if (!RETELL_API_KEY) return 0;

  const { data: stuck } = await supabase
    .from('brrr_property_calls')
    .select('*')
    .eq('status', 'completed')
    .is('qualification->>outcome' as never, null)
    .not('retell_call_id', 'is', null)
    .lt('updated_at', new Date(Date.now() - 3 * 60 * 1000).toISOString())
    .order('updated_at', { ascending: true })
    .limit(limit);
  if (!stuck || stuck.length === 0) return 0;

  const settings = await getBrrrSettings();
  let processed = 0;
  for (const callRow of stuck) {
    const { data: property } = await supabase
      .from('brrr_properties')
      .select('*')
      .eq('id', callRow.property_id)
      .single();
    if (!property) continue;

    const res = await fetch(`https://api.retellai.com/v2/get-call/${callRow.retell_call_id}`, {
      headers: { Authorization: `Bearer ${RETELL_API_KEY}` },
    });
    if (!res.ok) continue;
    const call = await res.json() as Record<string, any>;
    if (call.call_status !== 'ended') continue; // still live or errored — not ours to touch

    const transcriptForUI = (call.transcript_object || []).map((t: any) => ({
      speaker: t.role === 'user' ? 'caller' : 'agent',
      text: t.content,
    }));
    if (!call.transcript || transcriptForUI.length === 0) {
      // Nothing was said — close it out so it stops matching the sweep.
      await supabase.from('brrr_property_calls')
        .update({ summary: 'No conversation recorded.', qualification: { outcome: 'callback' }, updated_at: new Date().toISOString() })
        .eq('id', callRow.id);
      continue;
    }

    await processAnsweredBrrrCall(callRow, property, {
      transcript: call.transcript || '',
      transcriptForUI,
      recordingUrl: call.recording_url || null,
      costCents: call.call_cost?.combined_cost,
    }, settings);
    processed++;
  }
  return processed;
}
