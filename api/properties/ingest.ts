import { createClient } from '@supabase/supabase-js';
import { toE164, getBrrrSettings, queuePropertyCall } from '../lib/brrr.js';

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
      deal: body.deal && typeof body.deal === 'object' ? body.deal : {},
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('brrr_properties')
      .upsert(row, { onConflict: 'source,source_property_id' })
      .select('id, status')
      .single();

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    // "Send to Elsie" means cleared to call: queue the qualification call right
    // away (the dial cron only rings inside the configured calling hours).
    // Re-sends of already-processed properties don't re-queue.
    let callQueued = false;
    const settings = await getBrrrSettings();
    if (settings.auto_queue_on_ingest && row.agent_phone && ['new', 'call_queued'].includes(data.status)) {
      const q = await queuePropertyCall(data.id);
      callQueued = q.queued;
    }

    return new Response(JSON.stringify({ ok: true, id: data.id, status: data.status, call_queued: callQueued }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
