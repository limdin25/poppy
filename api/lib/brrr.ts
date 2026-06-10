// BRRR property qualifier — shared helpers for ingest, the dial cron and the
// Retell webhook branch. Properties live in brrr_properties (admin-only, no RLS);
// qualified ones become deals in Hugo's live business pipeline.
import { createClient } from '@supabase/supabase-js';
import { notifyBusinessOwner } from './notify.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;

export const PIPELINE_BUSINESS_ID = process.env.PROPERTY_PIPELINE_BUSINESS_ID || '';

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

export function fmtGBP(n: unknown): string {
  const v = typeof n === 'number' ? n : parseFloat(String(n || ''));
  if (!isFinite(v) || v <= 0) return 'an amount to be discussed';
  return `£${Math.round(v).toLocaleString('en-GB')}`;
}

export interface Qualification {
  outcome?: 'qualified' | 'not_qualified' | 'callback' | 'no_answer';
  still_available?: boolean | null;
  condition_notes?: string | null;
  why_selling?: string | null;
  chain?: string | null;
  tenure?: string | null;
  lease_years?: string | null;
  service_charge?: string | null;
  offer_reaction?: string | null;
  viewing_availability?: string | null;
  summary?: string | null;
  action_required?: string | null;
}

/** Extract a structured qualification from the call transcript via Claude. */
export async function extractQualification(
  transcript: string,
  property: BrrrProperty,
): Promise<Qualification> {
  const offer = fmtGBP((property.deal as Record<string, unknown>)?.offer_price);
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: `An AI assistant called the estate agent about ${property.address} (asking ${property.price_text}, our target offer ${offer}) to qualify it for a buy-refurbish-refinance purchase. Analyse the transcript and return JSON only:
{
  "outcome": "qualified" | "not_qualified" | "callback",
  "still_available": boolean or null,
  "condition_notes": string or null,
  "why_selling": string or null,
  "chain": string or null,
  "tenure": string or null,
  "lease_years": string or null,
  "service_charge": string or null,
  "offer_reaction": string or null (how the agent reacted to an offer around ${offer}),
  "viewing_availability": string or null,
  "summary": string (3-4 sentences),
  "action_required": string or null
}

"qualified" = still available AND the agent did not rule out an offer around ${offer} (open, "put it forward", "worth trying", vendor flexible).
"not_qualified" = sold/under offer/withdrawn, or the agent clearly said an offer at that level has no chance, or a deal-breaker came up (e.g. very short lease, cash-only structural issues beyond a £10k refurb).
"callback" = couldn't get answers (wrong person, asked to call back, agent needs to check with vendor).

Transcript:
${transcript}`,
      }],
    }),
  });
  const data = await res.json() as { content?: Array<{ text?: string }> };
  const text = data.content?.[0]?.text || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  return jsonMatch ? JSON.parse(jsonMatch[0]) : {};
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
  if (property.deal_id) return { ok: true, dealId: property.deal_id };

  // Estate agent as contact (find by phone, else create)
  let contactId: string | null = null;
  const phone = toE164(property.agent_phone);
  if (phone) {
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

  // "Qualified" stage — find or create
  let stageId: string | null = null;
  const { data: stage } = await supabase
    .from('pipeline_stages')
    .select('id')
    .eq('business_id', PIPELINE_BUSINESS_ID)
    .ilike('name', 'qualified')
    .maybeSingle();
  if (stage) {
    stageId = stage.id;
  } else {
    const { data: created } = await supabase
      .from('pipeline_stages')
      .insert({ business_id: PIPELINE_BUSINESS_ID, name: 'Qualified', color: 'emerald', sort_order: 2 })
      .select('id')
      .single();
    stageId = created?.id || null;
  }

  const deal = (property.deal || {}) as Record<string, unknown>;
  const q = qualification || {};
  const lines = [
    `BRRR property qualified by Elsie.`,
    property.listing_url ? `Listing: ${property.listing_url}` : null,
    `Asking: ${property.price_text || fmtGBP(property.asking_price)} · Offer target: ${fmtGBP(deal.offer_price)} · GDV: ${fmtGBP(deal.gdv)}`,
    deal.rent ? `Target rent: ${fmtGBP(deal.rent)}/mo · Cash needed: ${fmtGBP(deal.total_cash)}` : null,
    property.agent_name ? `Agent: ${property.agent_name} ${property.agent_phone || ''}` : null,
    q.summary ? `\nCall summary: ${q.summary}` : null,
    q.offer_reaction ? `Offer reaction: ${q.offer_reaction}` : null,
    q.viewing_availability ? `Viewings: ${q.viewing_availability}` : null,
  ].filter(Boolean);

  const offerValue = typeof deal.offer_price === 'number'
    ? deal.offer_price
    : parseFloat(String(deal.offer_price || '')) || property.asking_price || 0;

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

  const { data: property } = await supabase
    .from('brrr_properties')
    .select('*')
    .eq('id', callRow.property_id)
    .single();
  if (!property) return { ok: false, reason: 'property missing' };

  if (event === 'call_analyzed') {
    const analysis = call.call_analysis || {};
    if (analysis.call_summary && !callRow.summary) {
      await supabase
        .from('brrr_property_calls')
        .update({ summary: analysis.call_summary, updated_at: new Date().toISOString() })
        .eq('id', callRow.id);
    }
    return { ok: true };
  }

  // call_ended
  const transcriptForUI = (call.transcript_object || []).map((t: any) => ({
    speaker: t.role === 'user' ? 'caller' : 'agent',
    text: t.content,
  }));
  const answered = (call.transcript_object || []).some(
    (t: any) => t.role === 'user' && ((t.content as string) || '').trim().length > 0,
  );
  const nowIso = new Date().toISOString();

  if (!answered) {
    const attempts = callRow.attempts || 1;
    if (attempts >= 3) {
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
      // Retry in 2 hours
      await supabase.from('brrr_property_calls').update({
        status: 'pending',
        summary: `No answer (attempt ${attempts}) — retrying.`,
        next_attempt_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        updated_at: nowIso,
      }).eq('id', callRow.id);
      await supabase.from('brrr_properties')
        .update({ status: 'call_queued', updated_at: nowIso })
        .eq('id', property.id);
    }
    return { ok: true, outcome: 'no_answer' };
  }

  let qualification: Qualification = {};
  try {
    qualification = await extractQualification(call.transcript || '', property as BrrrProperty);
  } catch (e) {
    console.error('[brrr] extraction failed:', e);
  }
  const outcome = qualification.outcome || 'callback';

  await supabase.from('brrr_property_calls').update({
    status: 'completed',
    transcript: transcriptForUI,
    recording_url: call.recording_url || null,
    summary: qualification.summary || null,
    qualification,
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

  if (outcome === 'qualified') {
    await pushPropertyToPipeline(property as BrrrProperty, qualification).catch(() => null);
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
