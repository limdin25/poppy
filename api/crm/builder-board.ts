// The builder board. Reads wk_builder_board, and moves a card.
//
// Hugo, 2026-08-28, relaying Pedro: "a pipeline the same as we have for the
// properties but now for the builders, so he can coordinate which builder has
// been booked for what property."
//
// SAME GATE AS THE DESK, not admin_users. Every builder route before the Find
// Builders desk was gated on the admin table, which meant it was silently blank
// for Pedro, the only person who does this job.
//
// DRAGGING A CARD INTO Booked IS THE BOOKING. It calls the existing
// assignBuilderToProperty, which is the one writer of assigned_builder_id and
// already moves the branch card to 'Viewing booked', writes the audit row and
// rings the bell. Before this there was no button on Pedro's desk that could
// book anybody at all: the confirm press lived in an admin-only panel, so five
// builders who said "I'm coming" on the phone sat against houses that still
// read as having nobody.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { assignBuilderToProperty } from '../lib/builder-outreach.js';

export const config = { runtime: 'nodejs', maxDuration: 30 };

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const STAGES = ['to_do', 'chasing', 'talking', 'coming', 'booked', 'been', 'no'];

interface Who { id: string; email: string }

async function gate(req: VercelRequest): Promise<{ sb: SupabaseClient; who: Who } | null> {
  const jwt = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return null;
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: userResp } = await sb.auth.getUser(jwt);
  const user = userResp?.user;
  if (!user) return null;
  const caller = createClient(SUPABASE_URL, SERVICE_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: allowed } = await caller.rpc('wk_is_agent_or_admin');
  if (!allowed) return null;
  return { sb, who: { id: user.id, email: user.email ?? '' } };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ok = await gate(req);
  if (!ok) { res.status(403).json({ error: 'CRM access required' }); return; }
  const { sb, who } = ok;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = sb as any;

  if (req.method === 'GET') {
    const days = Math.min(90, Math.max(1, Number(req.query.days ?? 21) || 21));
    const { data, error } = await db.rpc('wk_builder_board', { p_days: days });
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ houses: group(data ?? []) });
    return;
  }

  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const action = String(body.action ?? '');
  const outreachId = String(body.outreachId ?? '');
  if (!outreachId) { res.status(400).json({ error: 'outreachId required' }); return; }

  const { data: row, error: rowErr } = await db
    .from('brrr_builder_outreach')
    .select('id, property_id, builder_id, stage')
    .eq('id', outreachId).maybeSingle();
  if (rowErr) { res.status(500).json({ error: rowErr.message }); return; }
  if (!row) { res.status(404).json({ error: 'That builder is not on this house' }); return; }

  if (action === 'move') {
    const stage = String(body.stage ?? '');
    if (!STAGES.includes(stage)) { res.status(400).json({ error: 'unknown stage' }); return; }

    // Booked is not a label, it is the booking. Delegate to the one function
    // that owns assigned_builder_id so the board, the cockpit and the inbox
    // cannot disagree about who is going.
    if (stage === 'booked') {
      // A refusal comes back HTTP 200 with ok:false, matching the cockpit: the
      // request worked, the answer is no, and the board shows the sentence.
      const out = await assignBuilderToProperty(sb, row.property_id, row.builder_id, who.id);
      if (!out.ok) { res.status(200).json({ ok: false, refusal: out.error }); return; }
    }

    // Leaving Booked un-books him. Pedro drags a man out because he dropped
    // out, and a house that still names him is the false green this board
    // exists to kill.
    if (row.stage === 'booked' && stage !== 'booked') {
      await db.from('brrr_properties')
        .update({ assigned_builder_id: null })
        .eq('id', row.property_id)
        .eq('assigned_builder_id', row.builder_id);
    }

    const patch: Record<string, unknown> = {
      stage,
      stage_moved_at: new Date().toISOString(),
      stage_moved_by: who.id,
      updated_at: new Date().toISOString(),
    };
    // "Been" is a fact with a time, and the card shows how long ago.
    if (stage === 'been') patch.attended_at = new Date().toISOString();
    const { error } = await db.from('brrr_builder_outreach').update(patch).eq('id', outreachId);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ ok: true, stage });
    return;
  }

  if (action === 'set') {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if ('comeBackAt' in body) {
      const v = body.comeBackAt;
      if (v === null || v === '') patch.come_back_at = null;
      else {
        const ms = Date.parse(String(v));
        if (!Number.isFinite(ms)) { res.status(400).json({ error: 'bad come back date' }); return; }
        patch.come_back_at = new Date(ms).toISOString();
      }
    }
    if ('comeBackNote' in body) patch.come_back_note = String(body.comeBackNote ?? '').slice(0, 300) || null;

    if ('agreedAt' in body) {
      const v = body.agreedAt;
      if (v === null || v === '') patch.agreed_at = null;
      else {
        const ms = Date.parse(String(v));
        if (!Number.isFinite(ms)) { res.status(400).json({ error: 'bad agreed date' }); return; }
        patch.agreed_at = new Date(ms).toISOString();
      }
    }

    for (const [key, col] of [['quoteAmount', 'quote_amount'], ['chargesAmount', 'charges_amount']] as const) {
      if (!(key in body)) continue;
      const v = body[key];
      if (v === null || v === '') { patch[col] = null; continue; }
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) { res.status(400).json({ error: `bad ${key}` }); return; }
      patch[col] = n;
      if (col === 'quote_amount') patch.quote_at = new Date().toISOString();
    }
    if ('quoteNote' in body) patch.quote_note = String(body.quoteNote ?? '').slice(0, 1000) || null;

    if (Object.keys(patch).length === 1) { res.status(400).json({ error: 'nothing to set' }); return; }
    const { error } = await db.from('brrr_builder_outreach').update(patch).eq('id', outreachId);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ ok: true });
    return;
  }

  res.status(400).json({ error: 'unknown action' });
}

interface Row {
  property_id: string; address: string; viewing_address: string | null; viewing_at: string | null;
  house_number_known: boolean; assigned_builder_id: string | null;
  outreach_id: string; builder_id: string; builder_name: string; builder_phone: string | null;
  contact_id: string | null; stage: string; status: string; channel: string;
  call_outcome: string | null; sent_at: string | null; replied_at: string | null;
  declined_at: string | null; agreed_at: string | null; come_back_at: string | null;
  come_back_note: string | null; attended_at: string | null;
  quote_amount: string | number | null; quote_note: string | null;
  charges_amount: string | number | null; address_sent_at: string | null;
  last_inbound_at: string | null; last_inbound_body: string | null; last_outbound_at: string | null;
}

/** One row per builder-per-house comes back flat; the board wants it by house. */
function group(rows: Row[]) {
  const byHouse = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    let h = byHouse.get(r.property_id);
    if (!h) {
      h = {
        propertyId: r.property_id,
        address: r.address,
        viewingAddress: r.viewing_address,
        viewingAt: r.viewing_at,
        houseNumberKnown: Boolean(r.house_number_known),
        assignedBuilderId: r.assigned_builder_id,
        cards: [] as unknown[],
      };
      byHouse.set(r.property_id, h);
    }
    (h.cards as unknown[]).push({
      outreachId: r.outreach_id,
      propertyId: r.property_id,
      builderId: r.builder_id,
      builderName: r.builder_name,
      builderPhone: r.builder_phone ?? '',
      contactId: r.contact_id,
      stage: r.stage,
      status: r.status,
      channel: r.channel,
      callOutcome: r.call_outcome,
      sentAt: r.sent_at,
      repliedAt: r.replied_at,
      declinedAt: r.declined_at,
      agreedAt: r.agreed_at,
      comeBackAt: r.come_back_at,
      comeBackNote: r.come_back_note,
      attendedAt: r.attended_at,
      quoteAmount: num(r.quote_amount),
      quoteNote: r.quote_note,
      chargesAmount: num(r.charges_amount),
      addressSentAt: r.address_sent_at,
      lastInboundAt: r.last_inbound_at,
      lastInboundBody: r.last_inbound_body ?? '',
      lastOutboundAt: r.last_outbound_at,
    });
  }
  return [...byHouse.values()];
}

/** numeric(12,2) arrives as a string from PostgREST. */
function num(v: string | number | null): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
