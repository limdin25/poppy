import { createClient } from '@supabase/supabase-js';
import { toE164, fmtGBP, getBrrrSettings, offerRange, type BrrrSettings } from '../lib/brrr.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const RETELL_API_KEY = process.env.RETELL_API_KEY!;

export const config = { runtime: 'edge' };

// "Hertford Street" out of "Flat 7, Hertford House, Hertford Street, Coventry CV1"
// — the human way to name a property on the phone.
function streetFromAddress(address: string | null): string {
  if (!address) return 'your listing';
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  const street = parts.find((p) =>
    /\b(street|road|lane|avenue|close|drive|way|court|place|terrace|gardens|grove|hill|park|row|crescent|square|walk|mews)\b/i.test(p));
  return street || parts[0] || 'your listing';
}

// Estate agencies only — never ring outside the configured calling hours.
function withinCallingHours(now: Date, s: BrrrSettings): boolean {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  const day = get('weekday');
  const minutes = parseInt(get('hour')) * 60 + parseInt(get('minute'));
  if (!s.call_days.includes(day)) return false;
  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map((v) => parseInt(v) || 0);
    return h * 60 + m;
  };
  return minutes >= toMin(s.call_start) && minutes <= toMin(s.call_end);
}

export default async function handler(req: Request): Promise<Response> {
  const authHeader = req.headers.get('authorization') || '';
  const cronSecret = process.env.CRON_SECRET || '';
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
  }

  const agentId = process.env.RETELL_PROPERTY_AGENT_ID;
  const fromNumber = process.env.PROPERTY_FROM_NUMBER;
  if (!agentId || !fromNumber) {
    return new Response(JSON.stringify({ ok: true, skipped: 'agent not configured' }), { status: 200 });
  }

  const settings = await getBrrrSettings();
  const now = new Date();
  if (!withinCallingHours(now, settings)) {
    return new Response(JSON.stringify({ ok: true, skipped: 'outside calling hours' }), { status: 200 });
  }

  try {
    const { data: pending } = await supabase
      .from('brrr_property_calls')
      .select('*')
      .eq('status', 'pending')
      .lte('next_attempt_at', now.toISOString())
      .order('next_attempt_at', { ascending: true })
      .limit(5);

    if (!pending || pending.length === 0) {
      return new Response(JSON.stringify({ ok: true, dialed: 0 }), { status: 200 });
    }

    // Each dial occupies the line for minutes — keep it to a few per tick.
    const MAX_DIALS_PER_RUN = settings.max_dials_per_run;
    let dialed = 0;
    const errors: string[] = [];

    for (const entry of pending) {
      if (dialed >= MAX_DIALS_PER_RUN) break;

      // Atomic claim — same pattern as the takeover queue: overlapping runs
      // both see the row, only one flips it to dialing.
      const { data: claimed } = await supabase
        .from('brrr_property_calls')
        .update({
          status: 'dialing',
          attempts: entry.attempts + 1,
          updated_at: now.toISOString(),
        })
        .eq('id', entry.id)
        .eq('status', 'pending')
        .lte('next_attempt_at', now.toISOString())
        .select('id');
      if (!claimed || claimed.length === 0) continue;

      const { data: property } = await supabase
        .from('brrr_properties')
        .select('*')
        .eq('id', entry.property_id)
        .single();

      const toNumber = toE164(property?.agent_phone);
      if (!property || !toNumber) {
        await supabase.from('brrr_property_calls')
          .update({ status: 'failed', error: 'no agent phone', updated_at: now.toISOString() })
          .eq('id', entry.id);
        continue;
      }

      const { min: offerMin, max: offerMax } = offerRange(property, settings);

      // Negotiation pack from the valuation engine (deal jsonb set by the scraper)
      const deal = (property.deal || {}) as Record<string, unknown>;
      const ladderArr = Array.isArray(deal.ladder) ? (deal.ladder as number[]).filter((n) => n > 0) : [];
      const ladderStr = ladderArr.length >= 2
        ? ladderArr.map((n) => fmtGBP(n)).join(', then ')
        : `${fmtGBP(offerMin)}, climbing at most to ${fmtGBP(offerMax)}`;
      const evidence = Array.isArray(deal.evidence) && (deal.evidence as string[]).length
        ? (deal.evidence as string[]).join('; ')
        : 'no sold-price evidence on file — rely on the asking price conversation';
      const FLAG_NOTES: Record<string, string> = {
        suspiciously_cheap_asking: 'the asking price is well below local sold prices — find out WHY (short lease? condition? cash buyers only?)',
        conversion_adds_no_value: 'bigger versions nearby do not sell for more — do not pay extra for conversion potential',
        indicative_valuation_verify_comps: 'valuation confidence is low — treat the figures as indicative',
        auction_guide_price: 'this is an auction listing — ask the auction date and whether the vendor takes pre-auction offers',
      };
      const notes = (Array.isArray(deal.flags) ? (deal.flags as string[]) : [])
        .map((f) => FLAG_NOTES[f]).filter(Boolean).join('; ') || 'none';

      const res = await fetch('https://api.retellai.com/v2/create-phone-call', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RETELL_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_number: fromNumber,
          to_number: toNumber,
          override_agent_id: agentId,
          ring_duration_ms: 60000,
          metadata: { type: 'brrr_property', property_call_id: entry.id, property_id: property.id },
          retell_llm_dynamic_variables: {
            property_address: property.address || 'the property',
            property_street: streetFromAddress(property.address),
            asking_price: property.price_text || fmtGBP(property.asking_price),
            offer_price: fmtGBP(offerMax),
            offer_min: fmtGBP(offerMin),
            offer_max: fmtGBP(offerMax),
            cmv: deal.cmv ? fmtGBP(deal.cmv) : 'unknown',
            cmv_confidence: String(deal.cmv_confidence || 'unknown'),
            negotiation_ladder: ladderStr,
            comp_evidence: evidence,
            valuation_notes: notes,
            agent_name: property.agent_name || 'the agency',
            bedrooms: String(property.bedrooms ?? ''),
            property_type: property.property_type || 'property',
            days_on_market: String(property.days_on_market ?? 'unknown'),
            callback_number: fromNumber,
          },
        }),
      });

      if (res.ok) {
        const call = await res.json() as { call_id?: string };
        await supabase.from('brrr_property_calls')
          .update({ retell_call_id: call.call_id || null, updated_at: new Date().toISOString() })
          .eq('id', entry.id);
        await supabase.from('brrr_properties')
          .update({ status: 'calling', updated_at: new Date().toISOString() })
          .eq('id', property.id);
        dialed++;
      } else {
        const errText = (await res.text()).slice(0, 200);
        errors.push(errText);
        const attempts = entry.attempts + 1;
        if (attempts >= settings.max_attempts) {
          await supabase.from('brrr_property_calls')
            .update({ status: 'failed', error: errText, updated_at: new Date().toISOString() })
            .eq('id', entry.id);
          await supabase.from('brrr_properties')
            .update({ status: 'no_answer', updated_at: new Date().toISOString() })
            .eq('id', property.id);
        } else {
          // Back to pending, retry after the configured gap
          await supabase.from('brrr_property_calls')
            .update({
              status: 'pending',
              error: errText,
              next_attempt_at: new Date(now.getTime() + settings.retry_hours * 60 * 60 * 1000).toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', entry.id);
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, dialed, errors }), { status: 200 });
  } catch (err: any) {
    console.error('[process-property-calls] error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
