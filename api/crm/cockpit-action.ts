// One endpoint, every button. Stress test first, act second, write it down
// third, and in that order without exception.
//
// Hugo, 2026-08-15: "one-click buttons for calls, emails and comparisons",
// "every move is backed by a stress test", "requires human approval to lock in
// the move."
//
// ---------------------------------------------------------------------------
// THE TWO RULES, ENFORCED STRUCTURALLY (tests/deal-cockpit-routes.test.ts)
// ---------------------------------------------------------------------------
//
//   THE MACHINE NEVER MOVES A CARD. There is no path from an assessment to a
//   pipeline write: the only one that exists is `move_stage`, which runs behind
//   a human press, through the gate, with the stage that human picked. It is
//   the same column write the board makes when you drag a card, so the two can
//   never disagree. Everything else that moves a card still moves it through
//   api/crm/property-outcome.ts, exactly as before.
//
//   Hugo, 2026-08-16: "if the action needed is to move pipeline we can do from
//   the cockpit." The rule was never "no card ever moves from here", it was
//   "the AI decides attention and words, code and humans decide money and
//   moves".
//
//   THIS FILE NEVER SENDS ANYTHING. A call is placed by the browser's Twilio
//   device and an email by the wk-email-send edge function. For those two the
//   server's whole job is to run the checks and record what happened, which is
//   why they come back as `execute: { how: 'client' }` rather than being done
//   here.
//
// A REFUSAL IS HTTP 200 with ok:false. It is the gate doing its job, not an
// error, the same principle api/crm/deal-manager.ts already lives by, and the
// UI prints `detail` verbatim next to a disabled button.
//
// phase 'check'  run the stress test, write nothing. What the gate calls on open.
// phase 'press'  do it.
// phase 'record' the browser finished a client-side action; file the outcome.

import { createClient } from '@supabase/supabase-js';
import { loadDealBundle, logEvent, stateHash, type Trigger } from '../lib/deal-manager-run.js';
import {
  stressTest, stressToText, ACTION_EXECUTION, ACTION_LABEL,
  COCKPIT_ACTIONS, type CockpitAction,
} from '../lib/deal-stress-test.js';
import { dealReasonLine } from '../lib/brrr-deal-facts.js';
import { effectiveCeiling } from '../lib/counter-position.js';
import { notifyDeal } from '../lib/deal-notify.js';
import { bestBranchEmail, firstNameFromEmail } from '../lib/branch-email-lookup.js';
import { needsProofOfFunds, signProofOfFunds } from '../lib/proof-of-funds.js';

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

interface Body {
  propertyId?: string;
  action?: string;
  phase?: 'check' | 'press' | 'record';
  draft?: { subject?: string; body?: string; kind?: string };
  dueAt?: string;
  note?: string;
  builderId?: string;
  /** For move_stage: the wk_pipeline_columns row the human picked. */
  columnId?: string;
  counter?: { theirFigure?: number | null; currentOffer?: number | null };
  outcome?: { ok: boolean; ref?: string; error?: string };
  requestId?: string;
}

const isCockpitAction = (a: string): a is CockpitAction =>
  (COCKPIT_ACTIONS as readonly string[]).includes(a);

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: userResp } = await supabase.auth.getUser(jwt);
  if (!userResp?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const actorId = userResp.user.id;

  const caller = createClient(SUPABASE_URL, SERVICE_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: allowed } = await caller.rpc('wk_is_agent_or_admin');
  if (!allowed) return Response.json({ error: 'CRM access required' }, { status: 403 });

  let body: Body;
  try { body = await req.json() as Body; }
  catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const action = String(body.action ?? '');
  if (!body.propertyId || !isCockpitAction(action)) {
    return Response.json({ error: 'propertyId and a known action are required' }, { status: 400 });
  }

  const now = new Date();
  const bundle = await loadDealBundle(supabase, body.propertyId, now);
  if (!bundle) return Response.json({ error: 'unknown property' }, { status: 404 });
  const { state } = bundle;

  // -----------------------------------------------------------------------
  // phase 'record': the browser did its half, file what happened
  // -----------------------------------------------------------------------
  if (body.phase === 'record') {
    // THE THREE ROADS. Hugo, 16 Aug: "after the first call you have three
    // options: reply the email (rare), lost, or ready for call two." A reply
    // that actually went out moves the card to Waiting on their answer, so
    // the desk clears and the board says where the deal really is. Behind the
    // human press only (this phase runs after the browser sent), and only
    // from the columns where the email IS the reply on price; a call-one
    // email never moves a card.
    if (action === 'send_email' && body.outcome?.ok !== false
      && bundle.contactId
      && ['Offer sent', 'Nurturing'].includes((state.board.column ?? '').trim())) {
      await moveCardTo(supabase, bundle.contactId, 'Waiting on their answer');
    }
    await logEvent(supabase, {
      property_id: state.propertyId,
      contact_id: bundle.contactId,
      kind: body.outcome?.ok === false ? 'action_blocked' : 'action_executed',
      trigger: 'button',
      action,
      board_column: state.board.column,
      state_hash: stateHash(state),
      source: 'human',
      actor_id: actorId,
      executed_by: 'client',
      result: body.outcome ?? null,
      refused_reason: body.outcome?.error ?? null,
      instruction: body.outcome?.ok === false
        ? `${ACTION_LABEL[action]} did not go through.`
        : `${ACTION_LABEL[action]}, done from the cockpit.`,
    });
    return Response.json({ ok: body.outcome?.ok !== false, report: emptyReport(action) });
  }

  // WHERE AN EMAIL WOULD GO. Resolved before the checks run, because "is
  // there an address to send to" is one of the checks, and the branch contact
  // having none does not mean we do not know one.
  const sendTo = await resolveSendTo(supabase, bundle);

  // -----------------------------------------------------------------------
  // THE STRESS TEST. Always, before anything else, for every phase.
  // -----------------------------------------------------------------------
  const report = stressTest({
    state,
    action,
    draft: body.draft ?? null,
    contactEmail: sendTo.email,
    contactPhone: bundle.phone,
    builderMatches: bundle.builderMatches,
    dueAt: body.dueAt ?? null,
    counter: body.counter ?? null,
    now,
  });

  // ---- the dry run: what the gate calls when it opens -------------------
  if (body.phase === 'check') {
    // A draft is fetched here too, so the text the checks ran against is the
    // text the human is about to read, not a different one written later.
    let draft: { subject: string; body: string } | undefined;
    // THE ATTACHMENT AND THE ADDRESS, both shown before anything is sent. The
    // proof of funds is named but NOT linked here: the signed url is minted at
    // press time so it is fresh and never sits in a browser longer than the
    // send takes.
    const attach = needsProofOfFunds({ brief: { blockers: state.brief.blockers, doNow: state.brief.doNow }, pinnedNote: state.pinnedNote });
    const emailExtras = {
      sendTo: sendTo.email,
      sendToEvidence: sendTo.evidence,
      willAttachProof: attach,
    };
    if (body.draft?.kind) {
      draft = await fetchDraft(req, jwt, bundle, body, sendTo) ?? undefined;
      if (draft) {
        // Re-run against the words that actually came back.
        const withDraft = stressTest({
          state, action, draft: { ...draft, kind: body.draft.kind },
          contactEmail: sendTo.email, contactPhone: bundle.phone,
          builderMatches: bundle.builderMatches, counter: body.counter ?? null, now,
        });
        return Response.json({ ok: withDraft.ok, report: withDraft, draft, ...emailExtras });
      }
    }
    // The approval desk: on the ballpark button the gate shows the callback
    // slot the brain read off the call, prefilled, so one press books Pedro.
    const suggestedDueAt = action === 'fetch_ballpark'
      ? suggestCallbackAt(state.calls.lastNote ?? state.conversation?.note ?? null, now)
      : undefined;
    return Response.json({ ok: report.ok, report, draft, suggestedDueAt, ...emailExtras });
  }

  // ---- refused ----------------------------------------------------------
  if (!report.ok) {
    await logEvent(supabase, {
      property_id: state.propertyId,
      contact_id: bundle.contactId,
      kind: 'action_blocked',
      trigger: 'button',
      action,
      board_column: state.board.column,
      state_hash: stateHash(state),
      source: 'human',
      actor_id: actorId,
      checks: report.checks,
      blocked: true,
      refused_reason: report.blocked[0] ?? 'blocked',
      instruction: stressToText(report),
    });
    const first = report.checks.find((c) => c.level === 'block');
    return Response.json({
      ok: false, report,
      refused: report.blocked[0] ?? 'blocked',
      detail: first?.detail ?? 'The checks refused this one.',
    });
  }

  // -----------------------------------------------------------------------
  // do it
  // -----------------------------------------------------------------------
  const execution = ACTION_EXECUTION[action];
  let result: Record<string, unknown> | null = null;
  let draft: { subject: string; body: string } | undefined;

  try {
    switch (action) {
      // ---- the browser finishes these two -----------------------------
      case 'call_branch':
        return await recordAndAnswer(supabase, {
          state, bundle, action, actorId, report,
          execute: {
            how: 'client' as const, via: 'call',
            payload: { contact_id: bundle.contactId, to_phone: bundle.phone },
          },
        });

      case 'send_email': {
        if (!body.draft?.subject || !body.draft?.body) {
          return Response.json({
            ok: false, report,
            refused: 'nothing_to_send',
            detail: 'There is no subject or message to send.',
          });
        }
        // THE PROOF OF FUNDS TRAVELS WITH THE EMAIL, exactly as it does from
        // the pipeline modal. Only when the deal actually asked for it: the
        // document carries account numbers, so it is never attached
        // speculatively. The signed link is minted HERE, seconds before the
        // browser posts the send, and dies in an hour.
        let attachment: { url: string; name: string } | null = null;
        if (needsProofOfFunds({
          brief: { blockers: state.brief.blockers, doNow: state.brief.doNow },
          pinnedNote: state.pinnedNote,
        })) {
          const proof = await signProofOfFunds(supabase);
          if (proof.available && proof.url) {
            attachment = { url: proof.url, name: proof.filename ?? 'Proof of funds.pdf' };
          }
        }
        return await recordAndAnswer(supabase, {
          state, bundle, action, actorId, report,
          execute: {
            how: 'client' as const, via: 'wk-email-send',
            payload: {
              contact_id: bundle.contactId,
              // The resolved address, not the branch row's empty one.
              to_email: sendTo.email,
              subject: body.draft.subject,
              body: body.draft.body,
              ...(attachment
                ? { attachment_url: attachment.url, attachment_name: attachment.name }
                : {}),
            },
          },
        });
      }

      // ---- proxied to the route that already carries the fences ---------
      case 'draft_video_email':
      case 'draft_address_only_email':
      case 'draft_offer_email':
      case 'draft_follow_up_email':
      case 'draft_counter_reply': {
        draft = await fetchDraft(req, jwt, bundle, body) ?? undefined;
        if (!draft) {
          return Response.json({
            ok: false, report,
            refused: 'draft_refused',
            detail: 'The draft was refused by its own checks. Send the plain template instead.',
          });
        }
        result = { subject: draft.subject };
        break;
      }

      // ---- server side, small and reversible ---------------------------
      case 'book_builder': {
        if (!body.builderId) {
          return Response.json({
            ok: false, report, refused: 'no_builder',
            detail: 'Pick which builder is going before booking one.',
          });
        }
        await (supabase.from('brrr_properties') as unknown as {
          update: (v: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<unknown> };
        }).update({
          assigned_builder_id: body.builderId,
          ...(body.dueAt ? { viewing_at: body.dueAt } : {}),
        }).eq('id', state.propertyId);
        result = { builderId: body.builderId, viewingAt: body.dueAt ?? null };
        break;
      }

      case 'book_followup': {
        if (!bundle.contactId) {
          return Response.json({
            ok: false, report, refused: 'no_contact',
            detail: 'This house has no branch record to book a follow up against.',
          });
        }
        await (supabase.from('wk_contact_followups') as unknown as {
          insert: (v: Record<string, unknown>) => Promise<unknown>;
        }).insert({
          contact_id: bundle.contactId,
          agent_id: actorId,
          due_at: body.dueAt,
          note: body.note ?? null,
          status: 'pending',
        });
        result = { dueAt: body.dueAt };
        break;
      }

      // ---- A HUMAN moving a card, from here instead of the board ---------
      //
      // THE RULE STILL HOLDS. The machine never moves a card: there is no path
      // from an assessment to this line, only from a press, through the gate,
      // with the stage the human picked. It writes the same column the board
      // writes when you drag one, so the two cannot disagree.
      case 'move_stage': {
        if (!body.columnId) {
          return Response.json({
            ok: false, report, refused: 'no_stage',
            detail: 'Pick which stage it moves to.',
          });
        }
        if (!bundle.contactId) {
          return Response.json({
            ok: false, report, refused: 'no_contact',
            detail: 'This house has no branch record to move.',
          });
        }
        await (supabase.from('wk_contacts') as unknown as {
          update: (v: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<unknown> };
        }).update({ pipeline_column_id: body.columnId }).eq('id', bundle.contactId);
        result = { from: state.board.column, toColumnId: body.columnId };
        break;
      }

      // ---- "Send to Lost": one press closes a door -----------------------
      // Still a human press through the gate, so the machine-never-moves rule
      // holds. The destination is not picked because there is only one: the
      // branch's own pipeline's Not interested column, the cockpit's existing
      // closed door.
      case 'mark_lost': {
        if (!bundle.contactId) {
          return Response.json({
            ok: false, report, refused: 'no_contact',
            detail: 'This house has no branch record to close.',
          });
        }
        const moved = await moveCardTo(supabase, bundle.contactId, 'Not interested');
        if (!moved) {
          return Response.json({
            ok: false, report, refused: 'no_lost_column',
            detail: 'There is no Not interested column on this board to send it to.',
          });
        }
        result = { from: state.board.column, to: 'Not interested' };
        break;
      }

      case 'fetch_ballpark': {
        const origin = new URL(req.url).origin;
        // THE CALLBACK IS NOT OPTIONAL. Confirming a ballpark books Pedro and
        // takes the card off the desk; without a follow-up the card would sit
        // in the cockpit as an already-made decision. No date from the human
        // means the one the brain read off the call note, or tomorrow 09:30.
        const dueAt = body.dueAt
          || suggestCallbackAt(state.calls.lastNote ?? state.conversation?.note ?? null, now);
        const res = await fetch(`${origin}/api/crm/fetch-ballpark`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
          // dueAt books Pedro's callback in the same press: approve once, the
          // band is armed, the card moves, and the callback is on his queue.
          body: JSON.stringify({ propertyId: state.propertyId, apply: true, dueAt }),
        });
        const json = await res.json().catch(() => ({})) as Record<string, unknown>;
        if (!res.ok) {
          return Response.json({
            ok: false, report, refused: 'ballpark_failed',
            detail: String(json.error ?? 'The engine could not price this one.'),
          });
        }
        result = json;
        break;
      }

      case 'escalate_hugo':
        await notifyDeal(supabase, {
          agentId: actorId,
          contactId: bundle.contactId,
          title: `Needs you: ${state.address ?? 'a property'}`,
          body: body.note?.trim() || state.brief.doNow[0] || 'Sent to you from the cockpit.',
          link: `/admin/crm/cockpit?deal=${state.propertyId}`,
        });
        result = { escalated: true };
        break;

      // ---- these two only ever write a line of history ------------------
      case 'assemble_investor_pack':
        // The gate above is the whole deliverable: every missing line blocks,
        // so reaching here means the pack is complete. It does NOT build a
        // document, deliberately, and that is written down in the plan.
        result = { packComplete: true };
        break;

      case 'compare_comps':
      case 'add_note':
      case 'hold':
        result = null;
        break;
    }
  } catch (e) {
    return Response.json({
      ok: false, report, refused: 'failed',
      detail: `That did not go through: ${String(e).slice(0, 160)}`,
    });
  }

  await logEvent(supabase, {
    property_id: state.propertyId,
    contact_id: bundle.contactId,
    kind: action === 'add_note' ? 'human_note' : 'action_executed',
    trigger: 'button',
    action,
    board_column: state.board.column,
    state_hash: stateHash(state),
    source: 'human',
    actor_id: actorId,
    executed_by: execution.by === 'client' ? 'client' : 'server',
    checks: report.checks,
    result,
    note: body.note ?? null,
    instruction: action === 'hold'
      ? 'Held on purpose. Nothing to do on this one today.'
      : `${ACTION_LABEL[action]}, from the cockpit.`,
  });

  return Response.json({ ok: true, report, draft });
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

type Bundle = NonNullable<Awaited<ReturnType<typeof loadDealBundle>>>;
type Sb = ReturnType<typeof createClient>;

async function recordAndAnswer(sb: Sb, args: {
  state: Bundle['state']; bundle: Bundle; action: CockpitAction; actorId: string;
  report: ReturnType<typeof stressTest>;
  execute: { how: 'client'; via: string; payload: Record<string, unknown> };
}): Promise<Response> {
  // Nothing is logged as DONE here: the browser has not done it yet. The
  // 'record' phase files the outcome once it has, so a call that never
  // connected cannot appear in the history as a call that happened.
  return Response.json({ ok: true, report: args.report, execute: args.execute });
}

/** Proxy to the draft route that already carries the three call-one fences.
 *
 *  Proxied rather than called from the browser so the stress test and the log
 *  row both see the text that was actually produced. api/crm/draft-offer-email.ts
 *  is not modified in any way, and its own 422 on a figure in a call-one email
 *  comes back here as a refusal. */
async function fetchDraft(
  req: Request, jwt: string, bundle: Bundle, body: Body,
  sendTo?: { email: string | null; recipientName: string | null },
): Promise<{ subject: string; body: string } | null> {
  const { state } = bundle;
  const origin = new URL(req.url).origin;

  // ---- WHICH DRAFTS ARE ALLOWED TO SEE MONEY AT ALL --------------------
  //
  // Caught on the live board 2026-08-16, walking the flow as a user. A
  // follow-up draft on Paterson Road, a house sitting in "Discovery done,
  // evaluating" where call two had NOT happened and no offer had ever been
  // made, came back saying "Our offer of GBP 151,072 still stands".
  //
  // The draft route was not at fault: it strips our figures out of the brief
  // with externalDoNow() precisely to stop this. THIS function handed it
  // `offerPrice` directly, whatever stage the deal was at, so the model was
  // told not to re-open the price while being shown the price. As
  // next-step-brief.ts puts it: that is not a fence, it is a hope.
  //
  // So the figures are simply not sent unless a figure has legitimately been
  // put to this branch already. A number the model was never given is a number
  // it cannot put in an email, and an email cannot be unsent.
  const FIGURE_HAS_BEEN_PUT_TO_THEM = [
    'Ballpark agreed', 'Needs viewing', 'Offer sent', 'Offer accepted',
    'Sent to investor', 'Deal closed', 'Renegotiate',
  ];
  const kind = body.draft?.kind ?? '';
  // An offer or a counter IS the conversation about price, so those carry the
  // figures by definition. Everything else has to have earned them.
  const alwaysMoney = kind === 'offer' || kind === 'counter_reply';
  const mayNameAFigure = alwaysMoney
    || FIGURE_HAS_BEEN_PUT_TO_THEM.includes((state.board.column ?? '').trim());

  const money = mayNameAFigure
    ? {
      askingPrice: state.money.asking,
      offerPrice: state.money.open,
      // THE SAME CAP THE STRESS TEST USED. Hugo's pinned ruling overrides the
      // engine's band in either direction; sending the engine ceiling alone
      // is how the gate approved a counter the draft then refused (DDM,
      // 16 Aug: "we are not able to improve our offer" against an ordered
      // counter at the pinned ladder).
      ceiling: effectiveCeiling(state.money.ceiling, state.money.pinnedCeiling),
      gdv: state.money.gdv,
      refurb: state.money.refurb,
    }
    : {};

  try {
    const res = await fetch(`${origin}/api/crm/draft-offer-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({
        kind: body.draft?.kind,
        agentName: bundle.contactName,
        // WHO THE EMAIL IS ADDRESSED TO. Hugo, 17 Aug: a draft bound for
        // leanne@movewithzest.co.uk opened "Hi Pedro", because the pinned note
        // said the statement goes "to Pedro to forward to Lucy" and the model
        // followed the note into the greeting. The recipient is a fact, not
        // something to infer from an internal instruction.
        recipientName: sendTo?.recipientName ?? null,
        recipientEmail: sendTo?.email ?? null,
        house: {
          address: state.address,
          ...money,
          reasonLine: dealReasonLine({ deal: {} }, []),
        },
        context: {
          doNow: state.brief.doNow,
          blockers: state.brief.blockers,
          pinnedNote: state.pinnedNote,
          step: state.brief.step,
          theirFigure: body.counter?.theirFigure ?? null,
          // Same rule: a follow-up before the offer stage is not shown what we
          // would pay, because it has no business mentioning it.
          currentOffer: mayNameAFigure
            ? (body.counter?.currentOffer ?? state.money.open) : null,
          evidenceTier: state.money.compsTier,
        },
      }),
    });
    if (!res.ok) return null;
    const json = await res.json() as { subject?: string; body?: string };
    if (!json.subject || !json.body) return null;
    return { subject: json.subject, body: json.body };
  } catch {
    return null;
  }
}

/** WHO THIS EMAIL GOES TO, resolved the same way the pipeline modal resolves
 *  it. Hugo, 17 Aug, same deal on two screens: the pipeline offered
 *  leanne@movewithzest.co.uk with the evidence for it, and the cockpit's gate
 *  said "there is no email address for this branch" and refused to send.
 *
 *  The branch contact's own address always wins (a saved address is a decision
 *  somebody made). Only when it has none is the lookup consulted, and the
 *  evidence travels with the address so the human sees WHERE it came from
 *  before pressing send. Never written back onto the contact from here. */
async function resolveSendTo(sb: Sb, bundle: Bundle): Promise<{
  email: string | null; evidence: string | null; recipientName: string | null;
}> {
  const own = (bundle.email ?? '').trim();
  if (own) {
    return { email: own, evidence: null, recipientName: firstNameFromEmail(own) };
  }
  const found = await bestBranchEmail(sb, {
    street: bundle.state.address, agency: bundle.contactName,
  });
  if (!found) return { email: null, evidence: null, recipientName: null };
  return {
    email: found.email,
    evidence: found.reason,
    recipientName: firstNameFromEmail(found.email),
  };
}

/** Move a branch card to a named column ON ITS OWN PIPELINE. Scoped because
 *  `Not interested` exists on the HeyPubli board too, and an unscoped name
 *  match once offered to move a house onto a different business's board. Only
 *  the column is written: wk_contacts_stage_move_stamp (20260727000006)
 *  stamps stage_moved_* and logs the timeline itself on every column change,
 *  and it overwrites anything a caller sets. Returns the column id it moved
 *  to, or null if the board has no such column (the caller decides whether
 *  that is a refusal). */
async function moveCardTo(sb: Sb, contactId: string, columnName: string): Promise<string | null> {
  // NOTE the bind: extracting `sb.from` as a bare function detaches `this`,
  // and SupabaseClient.from reads this.rest internally, so the first press of
  // Send to Lost died with "Cannot read properties of undefined (reading
  // 'rest')" (Hugo, live, 16 Aug). Methods stay on their object.
  const from = sb.from.bind(sb) as unknown as (t: string) => {
    select: (c: string) => {
      eq: (c: string, v: string) => {
        maybeSingle: () => Promise<{ data: Record<string, unknown> | null }>;
        eq: (c2: string, v2: string) => { maybeSingle: () => Promise<{ data: Record<string, unknown> | null }> };
      };
    };
    update: (v: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<unknown> };
  };
  const { data: contact } = await from('wk_contacts')
    .select('pipeline_column_id').eq('id', contactId).maybeSingle();
  const currentColId = (contact?.pipeline_column_id as string | null) ?? null;

  let pipelineId: string | null = null;
  if (currentColId) {
    const { data: cur } = await from('wk_pipeline_columns')
      .select('pipeline_id').eq('id', currentColId).maybeSingle();
    pipelineId = (cur?.pipeline_id as string | undefined) ?? null;
  }
  if (!pipelineId) {
    // Off the board: fall back to the property pipeline, found by a column
    // name that exists nowhere else (same trick as cockpit.ts).
    const { data: bp } = await from('wk_pipeline_columns')
      .select('pipeline_id').eq('name', 'Ballpark agreed').maybeSingle();
    pipelineId = (bp?.pipeline_id as string | undefined) ?? null;
  }
  if (!pipelineId) return null;

  const { data: col } = await from('wk_pipeline_columns')
    .select('id').eq('pipeline_id', pipelineId).eq('name', columnName).maybeSingle();
  const toId = (col?.id as string | undefined) ?? null;
  if (!toId || toId === currentColId) return toId;

  await from('wk_contacts').update({ pipeline_column_id: toId }).eq('id', contactId);
  return toId;
}

function emptyReport(action: CockpitAction) {
  return { action, ok: true, level: 'pass' as const, blocked: [], warned: [], checks: [] };
}

/** The callback slot Pedro agreed on the call, read from his own note.
 *
 *  Deterministic and deliberately modest: it recognises a weekday name (or
 *  tomorrow/today) in the note and proposes 09:30 UK that day, "monday" on a
 *  Monday meaning NEXT Monday. Anything it cannot read returns tomorrow at
 *  09:30, and the human edits the prefill either way. Never a parse of times
 *  like "half two", because a wrong booked time is worse than a default.
 */
export function suggestCallbackAt(note: string | null, now: Date): string {
  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const text = (note ?? '').toLowerCase();
  // Work in UK wall-clock, then emit ISO.
  const ukNowStr = now.toLocaleString('en-GB', { timeZone: 'Europe/London' });
  const [d, m, rest] = ukNowStr.split('/');
  const y = rest.slice(0, 4);
  const ukToday = new Date(`${y}-${m}-${d}T00:00:00`);
  let addDays = 1;
  if (/\btoday\b/.test(text)) addDays = 0;
  else if (/\btomorrow\b/.test(text)) addDays = 1;
  else {
    const named = DAYS.findIndex((day) => text.includes(day));
    if (named >= 0) {
      const delta = (named - ukToday.getDay() + 7) % 7;
      addDays = delta === 0 ? 7 : delta;
    }
  }
  const due = new Date(ukToday.getTime() + addDays * 86_400_000);
  due.setHours(9, 30, 0, 0);
  // The Date above is built in the server's zone but represents a UK wall
  // time; convert by asking what UTC instant shows 09:30 in London that day.
  const iso = new Date(due.getTime() - offsetMsAt(due)).toISOString();
  return iso;
}

/** London's UTC offset at a given wall-clock date, in milliseconds. */
function offsetMsAt(d: Date): number {
  const s = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', timeZoneName: 'longOffset',
  }).format(d);
  const m = s.match(/GMT([+-]\d{2}):(\d{2})/);
  if (!m) return 0;
  const sign = m[1].startsWith('-') ? -1 : 1;
  return sign * ((Math.abs(Number(m[1])) * 60 + Number(m[2])) * 60_000);
}
