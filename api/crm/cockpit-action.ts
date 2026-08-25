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

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadDealBundle, logEvent, stateHash, type Trigger } from '../lib/deal-manager-run.js';
import {
  stressTest, stressToText, ACTION_EXECUTION, ACTION_LABEL,
  COCKPIT_ACTIONS, suggestedMoveFor, type CockpitAction,
} from '../lib/deal-stress-test.js';
import { dealReasonLine } from '../lib/brrr-deal-facts.js';
import { floorRefusalFor } from '../lib/builder-outreach.js';
import { effectiveCeiling } from '../lib/counter-position.js';
import { notifyDeal } from '../lib/deal-notify.js';
import { bestBranchEmail, firstNameFromEmail } from '../lib/branch-email-lookup.js';
import { needsProofOfFunds, signProofOfFunds } from '../lib/proof-of-funds.js';
import {
  auditMoneyMove, shouldBreak, breakerMessage, MONEY_MOVES, BREAKER_WINDOW_HOURS,
} from '../lib/money-auditor.js';

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
  /** Where the card goes after a successful send, chosen by the human at the
   *  gate. Three states, all meaningful: a column id moves it there, an
   *  explicit null means "leave it where it is" and beats the default road,
   *  and absent means the default road decides. */
  afterColumnId?: string | null;
  requestId?: string;
  /** Hugo ticking "this is our best and final". Only ever honoured for an
   *  admin, and the admin check is made from the token, not from this flag.
   *  See StressInput.finalOfferInWriting. */
  finalOffer?: boolean;
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
    if (action === 'send_email' && body.outcome?.ok !== false && bundle.contactId) {
      // WHERE THE CARD LANDS. The human's pick at the gate wins; explicit null
      // is a veto ("leave it where it is") and beats the default road; absent
      // means the default road decides, exactly as before the dropdown
      // existed. Hugo, 17 Aug: "it shows the suggested column... and also
      // gives me the drop down if I wanna choose a different one."
      let landed: string | null = null;
      if (typeof body.afterColumnId === 'string' && body.afterColumnId) {
        landed = await moveCardToId(supabase, bundle.contactId, body.afterColumnId);
      } else if (body.afterColumnId === null) {
        landed = null;
      } else {
        const road = suggestedMoveFor('send_email', state.board.column);
        if (road) {
          const moved = await moveCardTo(supabase, bundle.contactId, road);
          landed = moved ? road : null;
        }
      }
      // AND THE CHASE IS BOOKED IN THE SAME PRESS. Hugo, 17 Aug: "send the
      // email now, click here to send the email now and follow up, and add the
      // follow-up in three days if they don't respond for calling."
      //
      // Only when the card actually lands in Waiting on their answer: a human
      // who sent the email and filed the branch under Not interested must not
      // get a "ring and chase them" appointment for a door they closed.
      //
      // Best effort on purpose. The email has ALREADY gone by this point and
      // cannot be unsent, so a failure here must never turn a successful send
      // into an error on the screen. A missing chase is a smaller problem than
      // a human believing their email did not go.
      if (landed === 'Waiting on their answer') {
        try {
          await bookChaseIn(supabase, {
            contactId: bundle.contactId, agentId: actorId, days: 3,
            note: 'No answer to our reply. Ring the branch and chase it.',
          });
        } catch (e) {
          console.error('[cockpit] chase booking failed after send', String(e).slice(0, 120));
        }
      }
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

  // OUR OWN PROOF OF FUNDS, when this deal's words ask for it. Resolved before
  // the checks too, because the total written on the statement is a figure the
  // email carrying it must be allowed to quote: the figure fence blocked the
  // whole proof-of-funds email on 17 Aug for naming GBP 102,071, which is not a
  // figure about the house but is exactly what the attached document shows.
  const wantsProof = needsProofOfFunds({
    brief: { blockers: state.brief.blockers, doNow: state.brief.doNow },
    pinnedNote: state.pinnedNote,
  });
  const proof = wantsProof ? await signProofOfFunds(supabase) : null;
  const extraFigures = proof?.totalGbp ? [proof.totalGbp] : null;

  // WHAT THE BRAIN DECIDED, AND WHO IS CARRYING IT OUT.
  //
  // Both go to the email writer, which had neither. Hugo, 17 Aug, on Stanks
  // Drive: the card ordered "Keeley's email asks for company registration
  // details. Reply with them today" and the draft under it read "I wanted to
  // follow up and see where things stand". The writer was fed the
  // DETERMINISTIC brief, which was empty on that card, while the decision sat
  // in the assessment and never travelled. Same decider-vs-executor drift as
  // the thread and the proof-of-funds facts before it.
  const draftContext = await loadDraftContext(supabase, state.propertyId, actorId);

  // -----------------------------------------------------------------------
  // THE STRESS TEST. Always, before anything else, for every phase.
  // -----------------------------------------------------------------------
  // WHO IS ASKING, decided here from the caller's own token and never from the
  // request body. The best-and-final override below is Hugo's alone, so a
  // browser must not be able to claim it by sending a flag.
  const { data: adminOk } = await caller.rpc('wk_is_admin');
  const isAdmin = adminOk === true;

  const report = stressTest({
    state,
    action,
    draft: body.draft ?? null,
    contactEmail: sendTo.email,
    contactPhone: bundle.phone,
    builderMatches: bundle.builderMatches,
    dueAt: body.dueAt ?? null,
    counter: body.counter ?? null,
    extraFigures,
    finalOfferInWriting: body.finalOffer === true,
    isAdmin,
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
    const emailExtras = {
      sendTo: sendTo.email,
      sendToEvidence: sendTo.evidence,
      willAttachProof: Boolean(proof?.available),
      // WHERE THE CARD LANDS if this goes through, so the gate can say so and
      // offer the dropdown instead of moving the card behind the human's back.
      afterMove: {
        suggested: suggestedMoveFor(action, state.board.column),
        current: state.board.column,
      },
    };
    // A check that CARRIES text is a re-check of the human's own words, and it
    // must test exactly those words. Until 2026-08-17 this branch regenerated
    // a fresh draft whenever a kind was present, edited text or not, so:
    //   1. ticking "best and final" took ~10 seconds of model time to answer a
    //      question about text the server already had, and the button sat grey
    //      the whole time (Hugo: "not clickable, i am logged in");
    //   2. the report described a REGENERATED draft, not the words in the box,
    //      so the gate could pass text the press would then refuse;
    //   3. the blur that ticking the box causes fired a second, un-flagged
    //      check, and whichever answer landed last won.
    // The top-level `report` above already stress-tested body.draft with the
    // finalOffer flag, which is the honest answer. Regeneration is only for a
    // gate that opens EMPTY.
    const hasEditedText = Boolean(
      String(body.draft?.subject ?? '').trim() || String(body.draft?.body ?? '').trim(),
    );
    if (body.draft?.kind && !hasEditedText) {
      draft = await fetchDraft(req, jwt, bundle, body, sendTo, Boolean(proof?.available), draftContext) ?? undefined;
      if (draft) {
        // Re-run against the words that actually came back.
        const withDraft = stressTest({
          state, action, draft: { ...draft, kind: body.draft.kind },
          contactEmail: sendTo.email, contactPhone: bundle.phone,
          builderMatches: bundle.builderMatches, counter: body.counter ?? null,
          extraFigures, finalOfferInWriting: body.finalOffer === true, isAdmin, now,
        });
        return Response.json({ ok: withDraft.ok, report: withDraft, draft, ...emailExtras });
      }
    }
    // The approval desk: on the ballpark button the gate shows the callback
    // slot the brain read off the call, prefilled, so one press books Pedro.
    // book_followup joined it on 17 Aug: the gate opened with an EMPTY time,
    // which the checks correctly refuse, so the button was dead on arrival and
    // the only way out was to type a date, which did not re-run the checks
    // either. A prefilled slot the human can edit is the same answer the
    // approval desk already gives.
    const suggestedDueAt = action === 'fetch_ballpark' || action === 'book_followup'
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

  // ---- THE SECOND READER, on money moves only ---------------------------
  //
  // Runs AFTER every deterministic fence has passed and BEFORE anything
  // commits. It never replaces those fences, it only catches what a rule
  // cannot: reading it like a person, does the money make sense against the
  // file. See api/lib/money-auditor.ts, including why it fails OPEN.
  //
  // Only on `press`. The dry run must stay fast and free, and nothing has
  // happened yet when the gate is merely open.
  // (`record` returned long before this line, and `check` returned above, so
  // by here the phase is always `press`.)
  if ((MONEY_MOVES as readonly string[]).includes(action)) {
    // The breaker first: if the pattern is already there, do not spend another
    // call to be told the same thing.
    const breaker = await moneyBreaker(supabase, now);
    if (breaker.broken) {
      await logEvent(supabase, {
        property_id: state.propertyId, contact_id: bundle.contactId,
        kind: 'action_blocked', trigger: 'button', action,
        board_column: state.board.column, state_hash: stateHash(state),
        source: 'human', actor_id: actorId, blocked: true,
        refused_reason: 'money_circuit_breaker',
        instruction: breakerMessage(breaker.strikes),
      });
      return Response.json({
        ok: false, report, refused: 'money_circuit_breaker',
        detail: breakerMessage(breaker.strikes),
      });
    }

    const second = await auditMoneyMove({
      state, action,
      subject: body.draft?.subject ?? null,
      body: body.draft?.body ?? null,
      // The attachment facts, when a statement rides with this press. Its
      // first live verdict blocked the Zest send for a "£1,529 shortfall"
      // that is actually the bridging structure; a reader that cannot see how
      // the purchase completes calls the design a mistake.
      proof: proof?.available
        ? { totalGbp: proof.totalGbp ?? null, fundingNote: proof.fundingNote ?? null }
        : null,
    });
    if (!second.agrees) {
      await logEvent(supabase, {
        property_id: state.propertyId, contact_id: bundle.contactId,
        kind: 'action_blocked', trigger: 'button', action,
        board_column: state.board.column, state_hash: stateHash(state),
        source: 'human', actor_id: actorId, blocked: true,
        refused_reason: 'second_reader_disagreed',
        instruction: second.reason,
      });
      return Response.json({
        ok: false, report, refused: 'second_reader_disagreed',
        detail: `A second check disagreed: ${second.reason} `
          + 'Nothing has been sent. Fix the figures or send it another way.',
      });
    }
    if (second.unavailable) {
      // Recorded, never fatal. A run of these is a fault worth seeing, and it
      // must not read like a run of approvals.
      console.warn('[cockpit] second reader unavailable:', second.unavailable, state.propertyId);
    }
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
        const attachment = proof?.available && proof.url
          ? { url: proof.url, name: proof.filename ?? 'Proof of funds.pdf' }
          : null;
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
        draft = await fetchDraft(req, jwt, bundle, body, undefined, Boolean(proof?.available), draftContext) ?? undefined;
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
        // The third road onto a house, after the invite send and the panel's
        // assign, and it gets the same gate: no builder prices a property whose
        // vendor has already refused more than our ceiling.
        const floorRefusal = await floorRefusalFor(supabase, state.propertyId);
        if (floorRefusal) {
          return Response.json({
            ok: false, report, refused: 'floor_above_ceiling', detail: floorRefusal,
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
        // Moved by ID and the NAME comes back, because what happens next
        // depends on which column it landed in. It also refuses a stale id
        // from a dialog left open on a column somebody has since deleted.
        const landed = await moveCardToId(supabase, bundle.contactId, body.columnId);
        if (!landed) {
          return Response.json({
            ok: false, report, refused: 'unknown_stage',
            detail: 'That stage no longer exists on this board. Reload and pick again.',
          });
        }

        // THE MOVE IS THE WHOLE ANSWER. NOTHING ELSE HAPPENS.
        //
        // Hugo, 17 Aug, twice: "I moved to ready for the 2nd call but still at
        // cockpit, I think when I do that it should be removed", and then, on
        // a first version of this that booked a callback with the move: "it is
        // not obliged to book the time for the follow up. When I move a lead to
        // a pipeline column, that's it."
        //
        // So the press writes a column and stops. What takes the card off the
        // desk is the `action_executed` row this press logs a few lines below:
        // `isCockpitDeal` sets aside a deal a human has moved by hand until
        // they write or a follow-up comes due. The card is never lost, it is on
        // the board in the column he chose, and the cockpit footer counts it.
        result = { from: state.board.column, to: landed, toColumnId: body.columnId };
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

      case 'escalate_hugo': {
        // "SEND IT TO HUGO" DID NOT SEND IT TO HUGO.
        //
        // It notified `actorId`, whoever pressed the button. Hugo pressing it
        // told Hugo, which looked like it worked; PEDRO pressing it told PEDRO,
        // and the boss heard nothing. Every escalation an agent has ever raised
        // from this button went into that agent's own bell.
        //
        // The card being flagged blocked_needs_hugo does still surface it on
        // Hugo's board, so nothing was lost silently, but the notification and
        // the email, which are the point of escalating, went to the wrong
        // person. Found 17 Aug when Hugo, signed in as an admin, asked the
        // obvious question: "what is it, send to Hugo, I am Hugo?"
        const admins = await adminRecipients(supabase);
        // Falling back to the presser is better than telling nobody, and it is
        // reported rather than hidden: an escalation that reached no admin is a
        // fact the history has to carry.
        const notify = admins.length ? admins : [actorId];
        for (const id of notify) {
          await notifyDeal(supabase, {
            agentId: id,
            contactId: bundle.contactId,
            title: `Needs you: ${state.address ?? 'a property'}`,
            body: body.note?.trim() || state.brief.doNow[0] || 'Sent to you from the cockpit.',
            link: `/admin/crm/cockpit?deal=${state.propertyId}`,
          });
        }
        result = { escalated: true, notified: notify.length, noAdminFound: admins.length === 0 };
        break;
      }

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
// NOT `ReturnType<typeof createClient>`. Unparameterised, that resolves to a
// client whose schema type is `never`, so passing a real client to any helper
// typed with it is an error. Nothing caught it because api/ was not type
// checked at all until 2026-08-17; see tsconfig.api.json. This is the same
// loose shape deal-manager-run.ts already uses.
type Sb = SupabaseClient<any, any, any>;

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

/** WHO "SEND IT TO HUGO" ACTUALLY REACHES.
 *
 *  The two ways somebody is an admin, straight out of `wk_is_admin()`: a row in
 *  `admin_users` matched by email, or `profiles.workspace_role = 'admin'`. Read
 *  here rather than assumed, because a hardcoded email is exactly what that
 *  function was rewritten to remove.
 *
 *  Returns an empty list rather than throwing. The caller decides what to do
 *  about that, and it tells the human, because "we could not find anybody to
 *  escalate to" must never look like a successful escalation. */
async function adminRecipients(sb: Sb): Promise<string[]> {
  const ids = new Set<string>();
  try {
    const from = sb.from.bind(sb) as unknown as (t: string) => {
      select: (c: string) => {
        eq: (a: string, b: string) => Promise<{ data: Array<{ id?: string }> | null }>;
        in: (a: string, b: string[]) => Promise<{ data: Array<{ id?: string }> | null }>;
        limit: (n: number) => Promise<{ data: Array<{ email?: string }> | null }>;
      };
    };
    const [{ data: byRole }, { data: rows }] = await Promise.all([
      from('profiles').select('id').eq('workspace_role', 'admin'),
      from('admin_users').select('email').limit(50),
    ]);
    for (const r of byRole ?? []) if (r.id) ids.add(r.id);
    const emails = (rows ?? []).map((r) => String(r.email ?? '').trim()).filter(Boolean);
    if (emails.length) {
      const { data: byEmail } = await from('profiles').select('id').in('email', emails);
      for (const r of byEmail ?? []) if (r.id) ids.add(r.id);
    }
  } catch (e) {
    console.warn('[cockpit-action] could not resolve admins', String(e).slice(0, 160));
  }
  return [...ids];
}

/** THE TWO THINGS THE EMAIL WRITER WAS MISSING: the decision, and a name.
 *
 *  The order is the brain's newest instruction on this deal, which is what a
 *  human is being told to do today. The writer had only `brief.doNow`, the
 *  deterministic brief, which is empty on most cards and was empty on the one
 *  Hugo was looking at.
 *
 *  Never throws: a draft written without the order is the old behaviour, and a
 *  log read that fails must not stop somebody answering an estate agent. */
async function loadDraftContext(
  sb: Sb, propertyId: string, actorId: string,
): Promise<{ order: string | null; senderName: string | null }> {
  const out: { order: string | null; senderName: string | null } = {
    order: null, senderName: null,
  };
  try {
    const [{ data: log }, { data: me }] = await Promise.all([
      (sb.from('wk_deal_manager_log') as any)
        .select('instruction, created_at')
        .eq('property_id', propertyId)
        .in('kind', ['assessment', 'fallback_refused'])
        .order('created_at', { ascending: false })
        .limit(1),
      (sb.from('profiles') as any).select('name').eq('id', actorId).maybeSingle(),
    ]);
    const instruction = String((log ?? [])[0]?.instruction ?? '').trim();
    out.order = instruction || null;
    const name = String(me?.name ?? '').trim();
    // An email address is not a name. profiles.name falls back to the email on
    // signup, and "hugo@nfstay.com" in a sign-off is worse than no name at all.
    out.senderName = name && !name.includes('@') ? name : null;
  } catch (e) {
    console.warn('[cockpit-action] draft context unavailable', String(e).slice(0, 160));
  }
  return out;
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
  /** True when the press will attach our proof of funds to this email. The
   *  writer has to be TOLD: on 17 Aug the statement was attached to a reply
   *  whose body never mentioned it, because the attachment was decided in this
   *  route and the description was gated to the follow_up kind. Hugo read the
   *  result and called it what it was: an email written blind. */
  attachingProof?: boolean,
  /** The brain's live order and the name of whoever is pressing, both read by
   *  the caller because this function has no database client of its own. */
  who?: { order?: string | null; senderName?: string | null },
): Promise<{ subject: string; body: string } | null> {
  const { state } = bundle;
  const origin = new URL(req.url).origin;
  const order = who?.order ?? null;
  const senderName = who?.senderName ?? null;

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
    'Ballpark agreed', 'Viewing booked', 'Offer sent', 'Offer accepted',
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
        // Unlocks the distilled checklist inside the drafter: what the branch
        // has already answered on the phone, with quotes. Pearson Street,
        // 18 Aug: without it the draft asked for a floor plan the call had
        // just located on the advert.
        propertyId: state.propertyId,
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
          // THE WHOLE FILE, not a slice (2026-08-17). Hugo, reading a draft
          // that re-negotiated a price the branch had already agreed to put
          // forward: "the brain is not checking all the emails exchanged, is
          // not checking the history of the whole thing, is just writing a
          // random email." He was right. The brain that DECIDES reads all of
          // this; the writer was handed the figures and a subject line.
          thread: state.writing.thread,
          callNote: state.conversation?.note ?? state.calls.lastNote ?? null,
          callTranscript: state.conversation?.transcript ?? null,
          attachingProof: attachingProof === true,
          // THE DECISION ITSELF. `brief.doNow` is the deterministic brief and
          // is empty on most cards; the order is what the human is actually
          // being told to do today, and the writer never saw it. Stanks Drive,
          // 17 Aug: the card said "Keeley's email asks for company registration
          // details, reply with them today" and the draft said "I wanted to
          // follow up and see where things stand".
          order: order ?? null,
          // WHO IS WRITING. The name on the profile of whoever pressed the
          // button, so the email signs off as a person. Deliberately NO phone
          // and NO email constant: the address is whatever this message is sent
          // FROM (replies thread back into the CRM inbox), and there is no
          // reliable per-agent number in this repo to hand a branch. A fact we
          // do not have is said to be coming, never invented.
          us: { person: senderName },
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
/** Book a chase call N days out, unless one is already waiting.
 *
 *  The dedupe matters more than it looks: a branch we reply to twice in a week
 *  would otherwise collect two chases for the same silence, and a calendar that
 *  cries wolf gets ignored, which costs more than the missing appointment would
 *  have. Same table and same shape as the book_followup button, so the two
 *  cannot drift into two kinds of follow-up. */
/** Is the money circuit breaker open right now.
 *
 *  Counts how many times the second reader has disagreed recently, from the one
 *  event stream that already records everything (`wk_deal_manager_log`), so
 *  there is no second tally to drift. The rule itself lives in money-auditor.ts
 *  and is pure. Never fatal: if the count cannot be read the breaker stays
 *  CLOSED, because a database hiccup is not evidence of bad offers, and the
 *  per-press check still runs. */
async function moneyBreaker(sb: Sb, now: Date): Promise<{ broken: boolean; strikes: number }> {
  try {
    const since = new Date(now.getTime() - BREAKER_WINDOW_HOURS * 3_600_000).toISOString();
    const { data } = await (sb.from('wk_deal_manager_log') as unknown as {
      select: (c: string) => { eq: (a: string, b: string) => { gte: (a: string, b: string) => Promise<{
        data: Array<{ created_at: string }> | null }> } };
    }).select('created_at').eq('refused_reason', 'second_reader_disagreed').gte('created_at', since);
    return shouldBreak((data ?? []).map((r) => r.created_at), now);
  } catch {
    return { broken: false, strikes: 0 };
  }
}

async function bookChaseIn(
  sb: Sb, args: { contactId: string; agentId: string | null; days: number; note: string },
): Promise<void> {
  const { data: waiting } = await (sb.from('wk_contact_followups') as unknown as {
    select: (c: string) => { eq: (a: string, b: unknown) => { eq: (a: string, b: unknown) => { limit: (n: number) => Promise<{ data: unknown[] | null }> } } };
  }).select('id').eq('contact_id', args.contactId).eq('status', 'pending').limit(1);
  if ((waiting ?? []).length) return;

  const due = new Date(Date.now() + args.days * 86_400_000);
  await (sb.from('wk_contact_followups') as unknown as {
    insert: (v: Record<string, unknown>) => Promise<unknown>;
  }).insert({
    contact_id: args.contactId,
    agent_id: args.agentId,
    due_at: due.toISOString(),
    note: args.note,
    status: 'pending',
  });
}

/** Move a card to a column the HUMAN picked by id at the gate. Returns the
 *  column's NAME when the move happened (the chase decision needs it), or null
 *  when the id matched no column, in which case nothing is written: a stale id
 *  from an open dialog must not file a card onto a column that was deleted. */
async function moveCardToId(sb: Sb, contactId: string, columnId: string): Promise<string | null> {
  const from = sb.from.bind(sb) as unknown as (t: string) => {
    select: (c: string) => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: Record<string, unknown> | null }> } };
    update: (v: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<unknown> };
  };
  const { data: col } = await from('wk_pipeline_columns')
    .select('name').eq('id', columnId).maybeSingle();
  const name = (col?.name as string | undefined) ?? null;
  if (!name) return null;
  await from('wk_contacts').update({ pipeline_column_id: columnId }).eq('id', contactId);
  return name;
}

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
