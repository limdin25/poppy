import { createClient } from '@supabase/supabase-js';
import { toE164 } from '../lib/brrr.js';
import { readDealMoney } from '../lib/brrr-offer.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

/**
 * Receives an approved property from Hugo's Rightmove scraper ("Send to Elsie").
 * Authenticated by shared secret — the scraper runs locally, outside Supabase auth.
 * Upserts by (source, source_property_id) so re-sending refreshes the data.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const secret = process.env.PROPERTY_INGEST_SECRET;
  if (!secret || req.headers.get('x-ingest-secret') !== secret) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
  }

  try {
    const body = await req.json() as Record<string, any>;
    const propertyId = String(body.property_id || '').trim();
    if (!propertyId) {
      return new Response(JSON.stringify({ error: 'property_id required' }), { status: 400 });
    }

    const priceText = body.price || null;
    const askingPrice = parseFloat(String(priceText || '').replace(/[^0-9.]/g, '')) || null;

    // The two brains on the VPS have already judged this deal. An ingest that
    // accepts what they rejected re-opens the exact holes they closed: the
    // engine's pursue=false was ignored once before (Linfield Terrace reached
    // Pedro with a £69,000 open the engine had called overpriced), and the
    // auditor exists because Holloway Head passed every other rule.
    const deal = body.deal && typeof body.deal === 'object'
      ? body.deal as Record<string, unknown> : {};

    // Does Elsie already know this property? It decides what a rejection means.
    const { data: existing } = await supabase
      .from('brrr_properties')
      .select('status')
      .eq('source', body.source || 'rightmove')
      .eq('source_property_id', propertyId)
      .maybeSingle();
    const prevStatus = existing?.status ?? null;

    let audit = deal.audit && typeof deal.audit === 'object'
      ? deal.audit as Record<string, unknown> : null;

    if (deal.pursue === false) {
      if (!existing) {
        // Unknown and not worth pursuing: never sent, never called, nothing to
        // explain. Refusing keeps the table free of properties nobody ever saw.
        return new Response(JSON.stringify({ ok: false, error: 'engine says do not pursue' }), { status: 422 });
      }
      // KNOWN, and the engine has changed its mind. It must be withdrawn here,
      // or the row keeps showing the numbers from before. When the refurb
      // costings were corrected on 2026-08-11 this was twenty properties still
      // sitting callable in Pedro's queue at yesterday's prices.
      const offerVerdict = String((deal.offer as Record<string, unknown>)?.verdict ?? '');
      const stackVerdict = String((deal.stack as Record<string, unknown>)?.verdict ?? '');
      const why = `the valuation engine no longer pursues this one${
        offerVerdict ? ` (offer: ${offerVerdict.replace(/_/g, ' ')}` : ''}${
        stackVerdict ? `, deal stack: ${stackVerdict.replace(/_/g, ' ')})` : offerVerdict ? ')' : ''}`;
      audit = {
        ...(audit ?? {}),
        verdict: 'kill',
        reasons: [...(Array.isArray(audit?.reasons) ? audit.reasons : []), 'engine_no_longer_pursues'],
        checks: [...(Array.isArray(audit?.checks) ? audit.checks : []),
          { level: 'kill', code: 'engine_no_longer_pursues', detail: why }],
      };
      deal.audit = audit;
    }

    const killed = audit?.verdict === 'kill' && audit?.forced !== true;
    if (killed) {
      // FILED, NOT REFUSED. A killed deal used to be rejected here and deleted
      // from the table, which emptied the branch: Dixons had one listing
      // (Holloway Head), it was withdrawn, and thirteen calls in Pedro's
      // history suddenly had nothing behind them at all. Losing the record is
      // the "flying blind after the call" this whole panel exists to end. So
      // the deal is kept with status 'auditor_killed', which no queue and no
      // dialer will touch (the assign script only takes new/call_queued, and
      // usePropertyListings hides withdrawn deals from Pedro), and Call
      // history can show what was withdrawn and why.
      (audit as Record<string, unknown>).filed_at = new Date().toISOString();
    }

    // A human outcome outranks a machine one. If somebody already qualified or
    // spoke to this branch, a later auditor kill must not overwrite that.
    const MACHINE_STATUSES = ['new', 'call_queued', 'auditor_killed'];
    let killedStatus: string | null = null;
    if (killed) {
      killedStatus = MACHINE_STATUSES.includes(prevStatus ?? 'new')
        ? 'auditor_killed'
        : prevStatus;
    } else if (prevStatus === 'auditor_killed') {
      // A KILL IS A VERDICT ABOUT TODAY'S DATA, NOT A TOMBSTONE. Deals are
      // re-judged every night, and a property whose comps have since improved
      // (or whose price has come down) must be able to come back. Without
      // this the row keeps the withdrawn status forever, the dialer keeps
      // hiding it and Pedro never sees a deal the engine has already cleared.
      killedStatus = 'new';
    }

    const row = {
      source: body.source || 'rightmove',
      source_property_id: propertyId,
      listing_url: body.listing_url || null,
      address: body.address || null,
      price_text: priceText,
      asking_price: askingPrice,
      price_qualifier: body.price_qualifier || null,
      bedrooms: parseInt(String(body.bedrooms || '')) || null,
      property_type: body.property_type || null,
      floor_area_sqm: parseFloat(String(body.floor_area_sqm || '')) || null,
      floor_area_sqft: parseFloat(String(body.floor_area_sqft || '')) || null,
      days_on_market: body.days_on_market != null ? String(body.days_on_market) : null,
      agent_name: body.agent_name || null,
      agent_phone: toE164(body.agent_phone) || body.agent_phone || null,
      agent_branch_url: body.agent_branch_url || null,
      floorplan_urls: Array.isArray(body.floorplans) ? body.floorplans : [],
      comps: Array.isArray(body.comps) ? body.comps : [],
      deal,
      ...(killedStatus ? { status: killedStatus } : {}),
      updated_at: new Date().toISOString(),
    };

    // NOTE: `row` deliberately does NOT carry call_channel. A re-send of a
    // property whose branch a human agent already owns must not reset it to
    // 'ai' and hand the branch back to anything else.
    const { data, error } = await supabase
      .from('brrr_properties')
      .upsert(row, { onConflict: 'source,source_property_id' })
      .select('id, status, wk_contact_id')
      .single();

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    // A RE-PRICE REFRESHES THE PHONE-CALL TOKENS (16 Aug audit). The nightly
    // engine rewrites deal, but the figures the coach and the script read live
    // on wk_contacts.custom_fields, so until the assign script's --refresh
    // happened to run, Pedro could be coached on yesterday's band. REFRESH
    // ONLY: a contact that carries no money keys is a discovery-stage branch
    // (assign-discovery-branches leaves them off on purpose so call one can
    // never quote a figure), and this must never introduce them. Best effort:
    // the property is already filed, so a token failure logs and moves on.
    if (!killed && data.wk_contact_id) {
      try {
        const { data: c } = await supabase
          .from('wk_contacts').select('custom_fields').eq('id', data.wk_contact_id).maybeSingle();
        const cf = ((c as { custom_fields?: Record<string, string> } | null)?.custom_fields
          ?? {}) as Record<string, string>;
        const hasMoney = Boolean((cf.offer_open ?? '').trim() || (cf.ladder ?? '').trim()
          || (cf.offer_ladder ?? '').trim());
        // ONE BRANCH, MANY HOUSES. The tokens on the contact belong to the
        // branch's HEADLINE listing; refreshing them from a different house's
        // re-price would put the wrong house's figures on the call.
        const sameHouse = Boolean((cf.property_address ?? '').trim()
          && String(body.address ?? '').trim()
          && (cf.property_address ?? '').trim() === String(body.address ?? '').trim());
        if (hasMoney && sameHouse) {
          const m = readDealMoney({ asking_price: askingPrice, deal });
          const gbp = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;
          const fields: Record<string, string> = { ...cf };
          fields.offer_open = m.open ? gbp(m.open) : '';
          fields.offer_ceiling = m.ceiling ? gbp(m.ceiling) : '';
          fields.ladder = m.ceiling
            ? (m.ladder.length > 1 ? m.ladder.map(gbp).join(', then ') : `${gbp(m.open ?? m.ceiling)}, up to ${gbp(m.ceiling)}`)
            : '';
          if (m.cmv) fields.property_worth = `${gbp(m.cmv)}${m.cmvConfidence ? ` (${m.cmvConfidence} confidence)` : ''}`;
          if (m.gdv) fields.worth_after_bed = `${gbp(m.gdv)} as a ${(parseInt(String(body.bedrooms || ''), 10) || 0) + 1} bed`;
          await supabase.from('wk_contacts')
            .update({ custom_fields: fields }).eq('id', data.wk_contact_id);
        }
      } catch (e) {
        console.warn('[ingest] token refresh failed', String(e).slice(0, 160));
      }
    }

    // Ingest NEVER starts a call. The AI property qualifier was retired on
    // 2026-08-09 (Hugo: "no more robot calls for the properties, that was just
    // a test"). "Send to Elsie" now only files the property; a human agent
    // picks it up through scripts/assign-properties-to-pedro-houses.mjs.
    // call_queued stays in the response so the scraper's existing parser, which
    // reads this field, keeps working against an older build.
    return new Response(JSON.stringify({
      ok: true, id: data.id, status: data.status, call_queued: false,
      withdrawn: killed,
    }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
