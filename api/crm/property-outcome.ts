// What happened on a property call a HUMAN made.
//
// Pedro rings an estate agency through the dialer, works the 16-question
// checklist in the Houses tab, and presses an outcome. This writes that down.
//
// Why an API route and not a SECURITY DEFINER RPC like the read side: a
// qualified property has to go through pushPropertyToPipeline() in
// api/lib/brrr.ts — roughly 120 lines that find-or-create a contact, find-or-
// create the pipeline stage, and create or MOVE a deal without duplicating it.
// Re-implementing that in plpgsql would be a second copy of the rule that
// decides whether Hugo has a deal, which is exactly the kind of duplication
// that has already bitten this codebase (see api/lib/brrr-offer.ts).
//
// The human row is shaped so every existing AI query skips it untouched:
//
//   the dial cron picks    status = 'pending'         -> this writes 'completed'
//   handleBrrrCallEvent    matches on retell_call_id  -> this writes NULL
//   sweepStuckExtractions  .not('retell_call_id', is, null)
//   queuePropertyCall      checks ('pending','dialing')
//
// The one deliberate crossover is the cron's same-agency spacing, which selects
// ('dialing','completed') and so DOES see this row. That is wanted: after Pedro
// rings a branch the AI must not ring it for 30 minutes.
// tests/property-human-call-isolation.test.ts pins all of it.

import { createClient } from '@supabase/supabase-js';
import {
  PIPELINE_BUSINESS_ID,
  pushPropertyToPipeline,
  type BrrrProperty,
  type Qualification,
} from '../lib/brrr.js';
import { notifyBusinessOwner } from '../lib/notify.js';

export const config = { runtime: 'edge' };

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/** What Pedro can pick. Mirrors Qualification['outcome'] in api/lib/brrr.ts so
 *  a human call and an AI call land the property in the same states.
 *
 *  'figure_obtained' was added 2026-08-10 with the script rewrite that has Pedro
 *  negotiate on the call rather than hand every money question to the director.
 *  The common end state is now "the agent said £X and it is on Hugo", which is
 *  neither 'qualified' (worth pursuing, nobody waiting) nor 'callback' (nothing
 *  learned). It files the deal under a stage of its own so the ones needing
 *  Hugo's decision are not buried among the ones that do not. */
const OUTCOMES = ['qualified', 'figure_obtained', 'not_qualified', 'callback', 'no_answer'] as const;
type Outcome = (typeof OUTCOMES)[number];

/** Outcomes that put the property in front of Hugo as a deal. */
const PIPELINE_OUTCOMES: readonly Outcome[] = ['qualified', 'figure_obtained'];

interface Body {
  property_id?: string;
  outcome?: string;
  /** The 16-question checklist, same keys as QUALIFICATION_QUESTIONS. */
  qualification?: Record<string, unknown>;
  /** Free text the agent typed. Appended to the property, never overwritten. */
  note?: string;
  /** The wk_calls row this outcome came from, so the two histories can be
   *  joined later. Optional: an agent may log an outcome after hanging up. */
  wk_call_id?: string;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: userResp } = await supabase.auth.getUser(jwt);
  const user = userResp?.user;
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  // Staff gate through the caller's own JWT so the database decides, not this
  // file. Same shape as api/crm/vsl-templates.ts.
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

  const { data: property, error: loadErr } = await supabase
    .from('brrr_properties')
    .select('*')
    .eq('id', propertyId)
    .single();
  if (loadErr || !property) {
    return Response.json({ error: 'property not found' }, { status: 404 });
  }

  const nowIso = new Date().toISOString();
  const qualification: Qualification = {
    ...(body.qualification as Qualification),
    outcome,
    // 'figure_obtained' IS the next step, so the agent is not asked to pick one
    // in a second control. Anything the agent already set wins.
    ...(outcome === 'figure_obtained' && !(body.qualification as Qualification)?.next_step
      ? { next_step: 'awaiting_director' as const }
      : {}),
  };
  const note = String(body.note || '').trim();

  // 1. The call record. Always written, even if the property update below is
  //    held back — losing what an agent typed is never acceptable.
  const { error: callErr } = await supabase.from('brrr_property_calls').insert({
    property_id: propertyId,
    status: 'completed',
    channel: 'human',
    human_agent_id: user.id,
    wk_call_id: body.wk_call_id || null,
    retell_call_id: null, // never matched by the Retell webhook
    attempts: 0,
    summary: note || null,
    qualification,
    updated_at: nowIso,
  });
  if (callErr) {
    return Response.json({ error: callErr.message }, { status: 500 });
  }

  // 2. The property itself — but only if the AI is not mid-dial on it. If it
  //    is, the webhook is about to write its own outcome and the last writer
  //    would win arbitrarily. The human record above is already safe.
  const { data: inFlight } = await supabase
    .from('brrr_property_calls')
    .select('id')
    .eq('property_id', propertyId)
    .in('status', ['pending', 'dialing'])
    .limit(1);

  if (property.status === 'calling' || (inFlight && inFlight.length > 0)) {
    return Response.json({
      ok: true,
      property_updated: false,
      reason: 'an AI call is in flight on this property; the call was logged but the status was left alone',
    });
  }

  const notes = note
    ? [property.notes, `[${nowIso.slice(0, 10)}] ${note}`].filter(Boolean).join('\n')
    : property.notes;

  const { error: updErr } = await supabase
    .from('brrr_properties')
    .update({ status: outcome, qualification, notes, updated_at: nowIso })
    .eq('id', propertyId);
  if (updErr) {
    return Response.json({ error: updErr.message }, { status: 500 });
  }

  // 3. A qualified property becomes a deal, through the SAME function the AI
  //    path calls, so both channels file deals identically (and it moves an
  //    existing deal rather than creating a second one).
  let dealId: string | null = property.deal_id ?? null;
  let warning: string | undefined;

  if (PIPELINE_OUTCOMES.includes(outcome)) {
    const pushed = await pushPropertyToPipeline(
      { ...property, qualification } as BrrrProperty,
      qualification,
    ).catch((e: unknown) => ({
      ok: false as const,
      error: e instanceof Error ? e.message : String(e),
    }));

    if (pushed.ok) {
      dealId = ('dealId' in pushed && pushed.dealId) || dealId;
      if (PIPELINE_BUSINESS_ID) {
        // Same shape as the AI path's notification (api/lib/brrr.ts:578), so
        // Hugo's alerts read the same whoever made the call.
        const awaiting = outcome === 'figure_obtained';
        await notifyBusinessOwner(PIPELINE_BUSINESS_ID, 'call', {
          title: `${awaiting ? 'Figure obtained, needs you' : 'Property qualified'}: ${property.address || property.source_property_id}`,
          body: [
            note || null,
            qualification.best_price_indicated ? `Agent said: ${qualification.best_price_indicated}` : null,
            qualification.offer_reaction ? `Offer reaction: ${qualification.offer_reaction}` : null,
            property.agent_phone ? `Agent: ${property.agent_name || ''} ${property.agent_phone}` : null,
            property.listing_url,
            awaiting
              ? 'A CRM agent got a figure out of the branch. Waiting on your decision.'
              : 'Qualified on a call by a CRM agent.',
          ].filter(Boolean).join('\n'),
        }).catch(() => {});
      }
    } else {
      // The outcome is already recorded. A pipeline hiccup must not read back
      // to the agent as "your call did not save".
      warning = `saved, but the pipeline push failed: ${'error' in pushed ? pushed.error : 'unknown'}`;
    }
  }

  // 4. Move the branch card to "Ballpark" on the CRM board.
  //
  //    Hugo, 2026-08-11: "we need a new pipeline where it says ballpark
  //    achieved, where the calls that we got the ballpark it goes there."
  //
  //    Step 3 above files the PROPERTY on the BRRR board (pipeline_stages,
  //    under "Awaiting director"). That is a different table from the CRM board
  //    Hugo watches all day (wk_pipeline_columns), and until now nothing moved
  //    the branch card there when a figure came out of a call. Dixons showed
  //    what that costs: a branch agreed GBP 95,000 at 12:22 and then sat in
  //    Interested among sixty other branches, indistinguishable from a branch
  //    that had merely been polite.
  //
  //    Best-effort by design. The outcome and the deal are already saved; a
  //    board that did not move must never read back to Pedro as "your call did
  //    not save". If the column has been renamed or deleted this does nothing
  //    rather than inventing one.
  let boardWarning: string | undefined;
  if (outcome === 'figure_obtained' && property.wk_contact_id) {
    try {
      const { data: contact } = await supabase
        .from('wk_contacts')
        .select('id, pipeline_column_id')
        .eq('id', property.wk_contact_id)
        .maybeSingle();

      if (contact) {
        // Find Ballpark in the board this contact is already on, so a workspace
        // with several pipelines cannot fling the card onto a foreign one.
        let pipelineId: string | null = null;
        if (contact.pipeline_column_id) {
          const { data: current } = await supabase
            .from('wk_pipeline_columns')
            .select('pipeline_id')
            .eq('id', contact.pipeline_column_id)
            .maybeSingle();
          pipelineId = current?.pipeline_id ?? null;
        }

        const q = supabase
          .from('wk_pipeline_columns')
          .select('id')
          .eq('name', 'Ballpark');
        const { data: ballpark } = await (pipelineId ? q.eq('pipeline_id', pipelineId) : q)
          .limit(1)
          .maybeSingle();

        if (ballpark?.id && ballpark.id !== contact.pipeline_column_id) {
          await supabase
            .from('wk_contacts')
            .update({
              pipeline_column_id: ballpark.id,
              stage_moved_at: nowIso,
              stage_moved_from: contact.pipeline_column_id,
              stage_moved_by: user.id,
              // 'agent', not 'automation': a CHECK constraint allows only
              // agent / automation / import / backfill, and this move is the
              // direct result of Pedro pressing Figure obtained. The board
              // should credit him, which is also what StageMoveChip renders.
              stage_move_source: 'agent',
            })
            .eq('id', contact.id);
        } else if (!ballpark?.id) {
          boardWarning = 'no Ballpark column on this board, so the card was left where it was';
        }
      }
    } catch (e: unknown) {
      boardWarning = `the card did not move: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  return Response.json({
    ok: true,
    property_updated: true,
    status: outcome,
    deal_id: dealId,
    ...(warning ? { warning } : {}),
    ...(boardWarning ? { board_warning: boardWarning } : {}),
  });
}
