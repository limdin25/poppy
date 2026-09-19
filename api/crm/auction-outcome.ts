// What happened on an auction call (Auction desk, Hugo 2026-09-18).
//
// Pedro rings an auction office about an unsold lot, writes down what they
// said in the Lots tab, and presses an outcome. This files it: the call record,
// the lot's status and answers, the office card's next step and board column,
// and, when the auctioneer named a figure, an alert to Hugo, because every
// figure goes to the director before anybody says yes. A post-auction sale
// exchanges on the auction's own terms (binding, 10% deposit, no survey), so a
// figure is a decision for Hugo, never for the call.
//
// Kept apart from api/crm/property-outcome.ts on purpose: that file writes the
// estate-agent brief, the builder address and the BRRR deal board, none of
// which mean anything for an auction lot.

import { createClient } from '@supabase/supabase-js';
import { PIPELINE_BUSINESS_ID } from '../lib/brrr.js';
import { notifyBusinessOwner } from '../lib/notify.js';

export const config = { runtime: 'edge' };

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/** Mirrors AUCTION_OUTCOMES in src/features/crm/components/live-call/LotsPane.tsx. */
export const OUTCOMES = ['figure_given', 'call_back', 'viewing_booked', 'sold', 'not_suitable', 'no_answer'] as const;
type Outcome = (typeof OUTCOMES)[number];

/** A lot in one of these is gone: the Lots tab greys it out. */
export const LOT_GONE = ['sold', 'not_suitable'] as const;

/** The office card's next step after each outcome. undefined = leave it. */
export const STEP_FOR_OUTCOME: Record<Outcome, string | undefined> = {
  figure_given: 'Director decides',
  call_back: 'Ring the auctioneer back',
  viewing_booked: 'Viewing booked',
  sold: undefined,
  not_suitable: undefined,
  no_answer: undefined,
};

/** Which Auction board column the office card moves to. Names are the ones
 *  seeded by migration 20260918000001, matched on the card's own board. */
export const BOARD_COLUMN_FOR: Partial<Record<Outcome, string>> = {
  figure_given: 'Lot: figure given',
  call_back: 'Lot: call back',
  viewing_booked: 'Lot: viewing booked',
};

/** When the LAST live lot at an office goes, the card goes with it. */
const COLUMN_WHEN_ALL_GONE: Partial<Record<Outcome, string>> = {
  sold: 'Lot: sold elsewhere',
  not_suitable: 'Lot: not suitable',
};

interface Body {
  property_id?: string;
  outcome?: string;
  seller_figure?: string;
  note?: string;
  wk_call_id?: string;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: userResp } = await supabase.auth.getUser(jwt);
  const user = userResp?.user;
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const caller = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: allowed } = await caller.rpc('wk_is_agent_or_admin');
  if (!allowed) return Response.json({ error: 'CRM access required' }, { status: 403 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const propertyId = String(body.property_id || '').trim();
  const outcome = String(body.outcome || '') as Outcome;
  if (!propertyId) return Response.json({ error: 'property_id required' }, { status: 400 });
  if (!OUTCOMES.includes(outcome)) {
    return Response.json({ error: `outcome must be one of ${OUTCOMES.join(', ')}` }, { status: 400 });
  }
  const figure = String(body.seller_figure || '').trim();
  const note = String(body.note || '').trim();
  if (outcome === 'figure_given' && !figure) {
    return Response.json({ error: 'type the figure they gave before pressing Figure given' }, { status: 400 });
  }

  const { data: lot, error: loadErr } = await supabase
    .from('brrr_properties')
    .select('id, address, desk, auction, qualification, notes, wk_contact_id, agent_phone, listing_url')
    .eq('id', propertyId)
    .single();
  if (loadErr || !lot) return Response.json({ error: 'lot not found' }, { status: 404 });
  if (lot.desk !== 'auction') return Response.json({ error: 'not an auction lot' }, { status: 400 });

  const nowIso = new Date().toISOString();
  const answers: Record<string, unknown> = {
    outcome,
    ...(figure ? { seller_figure: figure } : {}),
    ...(note ? { last_note: note } : {}),
  };

  // 1. The call record. Always written first: what Pedro typed is never lost.
  const { error: callErr } = await supabase.from('brrr_property_calls').insert({
    property_id: propertyId,
    status: 'completed',
    channel: 'human',
    human_agent_id: user.id,
    wk_call_id: body.wk_call_id || null,
    retell_call_id: null,
    attempts: 0,
    summary: [figure ? `Seller figure: ${figure}` : null, note || null].filter(Boolean).join('. ') || null,
    qualification: answers,
    updated_at: nowIso,
  });
  if (callErr) return Response.json({ error: callErr.message }, { status: 500 });

  // 2. The lot. Answers merge: a blank on a later call means "not asked
  //    again", never "the answer is nothing".
  const prior = (lot.qualification ?? {}) as Record<string, unknown>;
  const merged = { ...prior, ...answers };
  const notes = note ? [lot.notes, `[${nowIso.slice(0, 10)}] ${note}`].filter(Boolean).join('\n') : lot.notes;
  const { error: updErr } = await supabase
    .from('brrr_properties')
    .update({ status: outcome, qualification: merged, notes, updated_at: nowIso })
    .eq('id', propertyId);
  if (updErr) return Response.json({ error: updErr.message }, { status: 500 });

  // 3. The office card: next step, and the board column. Best effort, the
  //    outcome is already saved.
  let boardWarning: string | undefined;
  if (lot.wk_contact_id) {
    try {
      const { data: contact } = await supabase
        .from('wk_contacts')
        .select('id, pipeline_column_id, custom_fields')
        .eq('id', lot.wk_contact_id)
        .maybeSingle();
      if (contact) {
        const fields = { ...((contact.custom_fields ?? {}) as Record<string, string>) };
        const step = STEP_FOR_OUTCOME[outcome];
        if (step) fields.next_step = step;
        await supabase.from('wk_contacts').update({ custom_fields: fields }).eq('id', contact.id);

        let target = BOARD_COLUMN_FOR[outcome];
        if (!target && COLUMN_WHEN_ALL_GONE[outcome]) {
          const { count } = await supabase
            .from('brrr_properties')
            .select('id', { count: 'exact', head: true })
            .eq('wk_contact_id', contact.id)
            .eq('desk', 'auction')
            .not('status', 'in', `(${[...LOT_GONE, 'auditor_killed'].join(',')})`);
          if ((count ?? 0) === 0) target = COLUMN_WHEN_ALL_GONE[outcome];
        }
        if (target) {
          const { data: board } = await supabase
            .from('wk_pipelines').select('id').eq('desk', 'auction').limit(1).maybeSingle();
          const { data: col } = board
            ? await supabase.from('wk_pipeline_columns').select('id')
              .eq('pipeline_id', board.id).eq('name', target).maybeSingle()
            : { data: null };
          if (col?.id && col.id !== contact.pipeline_column_id) {
            await supabase.from('wk_contacts').update({
              pipeline_column_id: col.id,
              stage_moved_at: nowIso,
              stage_moved_from: contact.pipeline_column_id,
              stage_moved_by: user.id,
              stage_move_source: 'agent',
            }).eq('id', contact.id);
          } else if (!col?.id) {
            boardWarning = `no ${target} column on the Auction board, so the card was left where it was`;
          }
        }
      }
    } catch (e) {
      boardWarning = `the card did not move: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  // 4. A figure goes to the director. Same alert path as a Houses figure.
  if (outcome === 'figure_given' && PIPELINE_BUSINESS_ID) {
    const a = (lot.auction ?? {}) as Record<string, unknown>;
    await notifyBusinessOwner(PIPELINE_BUSINESS_ID, 'call', {
      title: `Auction figure, needs you: lot ${a.lot_number ?? '?'} ${lot.address ?? ''}`.trim(),
      body: [
        `${a.house ?? 'The auctioneer'} says the seller would take: ${figure}`,
        a.price_to_beat ? `The seller was holding out for up to £${Number(a.price_to_beat).toLocaleString('en-GB')}.` : null,
        note ? `Pedro wrote: ${note}` : null,
        lot.agent_phone ? `Office: ${lot.agent_phone}` : null,
        lot.listing_url,
      ].filter(Boolean).join('\n'),
    }).catch(() => {});
  }

  return Response.json({ ok: true, status: outcome, ...(boardWarning ? { board_warning: boardWarning } : {}) });
}
