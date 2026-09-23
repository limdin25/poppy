// What happened on a Serviced Accommodation call (SA desk, Hugo 2026-09-23).
//
// Pedro rings a letting agent about a city-centre flat and asks whether it
// could be let, in principle, to a serviced accommodation company. WE ARE THE
// MIDDLEMAN: Hugo, "agent or landlord to say yes, doesn't matter. And then
// after that, we're gonna find a service accommodation company that will rent
// from the landlord." So a yes in principle goes straight to Hugo.
//
// This files it: the answer on the flat (sa_listings), the agency card's next
// step and board column, and the alert to Hugo on a yes. An agency that says it
// never does company lets is retired: scripts/lib/sa-listings.mjs never deals
// it again.
//
// Kept apart from auction-outcome.ts and property-outcome.ts on purpose: both
// write to brrr_properties, which a rental never touches.

import { createClient } from '@supabase/supabase-js';
import { PIPELINE_BUSINESS_ID } from '../lib/brrr.js';
import { notifyBusinessOwner } from '../lib/notify.js';

export const config = { runtime: 'edge' };

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/** Mirrors SA_OUTCOMES in src/features/crm/components/live-call/SaListingPane.tsx. */
export const OUTCOMES = ['yes_in_principle', 'checking_with_landlord', 'said_no', 'no_company_lets', 'already_let', 'no_answer'] as const;
type Outcome = (typeof OUTCOMES)[number];

/** The agency card's next step after each outcome. undefined = leave it. */
export const STEP_FOR_OUTCOME: Record<Outcome, string | undefined> = {
  yes_in_principle: 'Yes in principle, Hugo brings the company',
  checking_with_landlord: "Ring back for the landlord's answer",
  said_no: undefined,
  no_company_lets: undefined,
  already_let: undefined,
  no_answer: undefined,
};

/** Which SA board column the agency card moves to. Names are the ones seeded
 *  by migration 20260923000001. No answer is left to the dialer's own
 *  Voicemail / No pickup handling. */
export const BOARD_COLUMN_FOR: Partial<Record<Outcome, string>> = {
  yes_in_principle: 'SA: yes in principle',
  checking_with_landlord: 'SA: checking with landlord',
  said_no: 'SA: said no',
  no_company_lets: 'SA: no company lets',
  already_let: 'SA: already let',
};

interface Body {
  listing_id?: string;
  outcome?: string;
  person?: string;
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

  const listingId = String(body.listing_id || '').trim();
  const outcome = String(body.outcome || '') as Outcome;
  if (!listingId) return Response.json({ error: 'listing_id required' }, { status: 400 });
  if (!OUTCOMES.includes(outcome)) {
    return Response.json({ error: `outcome must be one of ${OUTCOMES.join(', ')}` }, { status: 400 });
  }
  const person = String(body.person || '').trim();
  const note = String(body.note || '').trim();
  if (outcome === 'yes_in_principle' && !person) {
    return Response.json({ error: 'write who said yes (name, and agent or landlord) before pressing Yes in principle' }, { status: 400 });
  }

  const { data: flat, error: loadErr } = await supabase
    .from('sa_listings')
    .select('id, address, city, rent_pcm, bedrooms, property_type, agency, agency_phone, listing_url, outcome_note, wk_contact_id')
    .eq('id', listingId)
    .single();
  if (loadErr || !flat) return Response.json({ error: 'flat not found' }, { status: 404 });

  const nowIso = new Date().toISOString();

  // 1. The answer on the flat. Always written first: what Pedro typed is never
  //    lost, and earlier answers are kept underneath.
  const said = [person ? `Spoke to ${person}` : null, note || null].filter(Boolean).join('. ');
  const outcomeNote = said
    ? [flat.outcome_note, `[${nowIso.slice(0, 10)}] ${said}`].filter(Boolean).join('\n')
    : flat.outcome_note;
  const { error: updErr } = await supabase
    .from('sa_listings')
    .update({ outcome, outcome_note: outcomeNote, outcome_at: nowIso, outcome_by: user.id })
    .eq('id', listingId);
  if (updErr) return Response.json({ error: updErr.message }, { status: 500 });

  // 2. The agency card: next step, and the board column. Best effort, the
  //    answer is already saved.
  let boardWarning: string | undefined;
  if (flat.wk_contact_id) {
    try {
      const { data: contact } = await supabase
        .from('wk_contacts')
        .select('id, pipeline_column_id, custom_fields')
        .eq('id', flat.wk_contact_id)
        .maybeSingle();
      if (contact) {
        const step = STEP_FOR_OUTCOME[outcome];
        if (step) {
          const fields = { ...((contact.custom_fields ?? {}) as Record<string, string>), next_step: step };
          await supabase.from('wk_contacts').update({ custom_fields: fields }).eq('id', contact.id);
        }
        const target = BOARD_COLUMN_FOR[outcome];
        if (target) {
          const { data: board } = await supabase
            .from('wk_pipelines').select('id').eq('desk', 'sa').limit(1).maybeSingle();
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
            boardWarning = `Saved. There is no ${target} column on the Serviced Accommodation board, so the card was left where it was.`;
          }
        }
      }
    } catch (e) {
      boardWarning = `Saved. The card did not move: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  // 3. A yes in principle goes to Hugo. Same alert path as a Houses figure.
  if (outcome === 'yes_in_principle' && PIPELINE_BUSINESS_ID) {
    const rent = flat.rent_pcm ? `£${Number(flat.rent_pcm).toLocaleString('en-GB')} a month` : null;
    await notifyBusinessOwner(PIPELINE_BUSINESS_ID, 'call', {
      title: `SA yes in principle: ${flat.address ?? ''}`.trim(),
      body: [
        `${person} said yes in principle to a company let for serviced accommodation.`,
        [flat.bedrooms ? `${flat.bedrooms} bed` : null, flat.property_type, flat.city, rent].filter(Boolean).join(', '),
        note ? `Pedro wrote: ${note}` : null,
        `Agency: ${flat.agency} ${flat.agency_phone}`,
        flat.listing_url,
      ].filter(Boolean).join('\n'),
    }).catch(() => {});
  }

  return Response.json({ ok: true, outcome, ...(boardWarning ? { board_warning: boardWarning } : {}) });
}
