// The approval gate. THE ONLY COMPONENT IN THE COCKPIT THAT COMMITS ANYTHING.
//
// Hugo, 2026-08-15: "requires human approval to lock in the move."
//
// Three regions, always in this order:
//
//   1. The exact thing about to happen, in one present-tense sentence. Never
//      "the AI will", never a past tense that implies it is already done.
//   2. The stress test, RE-RUN LIVE on open rather than trusting the checks
//      that came down with the list twenty minutes ago.
//   3. The payload: for an email, the recipient and the draft, both editable.
//
// A blocking check disables the commit button and prints its reason verbatim
// above it, in English. Never a tooltip, never a code, never "validation
// failed": somebody has to be able to fix it or decide it is wrong.
//
// A warning does NOT disable. It relabels the button to "anyway" and asks for
// an acknowledgement, because judgement stays with the human.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { supabase } from '@/integrations/supabase/browser';
import { useAuth } from '../../lib/useCrmAuth';
import { gbpShort } from '../../../../../api/lib/brrr-offer';
import StressTestList from './StressTestList';
import { COCKPIT_ACTIONS, confirmSentence, commitVerbFor, type CockpitAction } from './cockpitActions';
import { useCockpitAction } from '../../hooks/useCockpit';
import type { CockpitDeal, StressReport } from './types';

/** The actions where money changes hands or a figure is committed to, so the
 *  approval shows the breakdown. Hugo, 16 Aug: "the AI decides, but I approve
 *  ... and then it shows me the breakdown of how much money gonna make." */
const MONEY_GATE_ACTIONS: CockpitAction[] = [
  'fetch_ballpark', 'draft_offer_email', 'draft_counter_reply', 'move_stage',
];

/** The actions whose checks depend on a TIME the human picks in this dialog.
 *  Their verdict has to be re-asked when that time changes, or the gate is
 *  judging a payload nobody is sending. */
const TIMED_ACTIONS: CockpitAction[] = ['book_followup', 'fetch_ballpark', 'book_builder'];

interface Props {
  deal: CockpitDeal;
  action: CockpitAction;
  /** Every stage a human may move this card to. From the server: the client
   *  holds no copy of the board. */
  stages: Array<{ id: string; name: string }>;
  onCancel: () => void;
  onCommitted: () => void;
  /** Opens the CRM's one call room over the cockpit and dials. */
  onCall: (contactId: string) => void;
}

export default function ActionConfirmDialog({ deal, action, stages, onCancel, onCommitted, onCall }: Props) {
  const spec = COCKPIT_ACTIONS[action];
  const { run } = useCockpitAction();
  const { isAdmin } = useAuth();

  const [report, setReport] = useState<StressReport | null>(null);
  const [checking, setChecking] = useState(true);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  /** Hugo deliberately putting our maximum in writing. See `ceilingBlocked`. */
  const [finalOffer, setFinalOffer] = useState(false);

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  // Where the email is actually going, resolved by the server, with the
  // evidence for it when it did not come off the branch card itself.
  const [sendTo, setSendTo] = useState<string | null>(null);
  const [sendToEvidence, setSendToEvidence] = useState<string | null>(null);
  const [willAttachProof, setWillAttachProof] = useState(false);
  const [note, setNote] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [columnId, setColumnId] = useState('');
  // WHERE THE CARD LANDS after a send. 'stay' is a real choice (a veto on the
  // default move), a column id is the destination, '' means the server has not
  // answered yet. Hugo, 17 Aug: "it shows the suggested column of the pipeline
  // where it should go after the email is sent, and also gives me the drop
  // down if I wanna choose a different one."
  const [afterChoice, setAfterChoice] = useState('');
  const [afterSuggested, setAfterSuggested] = useState<string | null>(null);
  // So a draft that lands late never overwrites what somebody has started
  // typing. Same rule PropertyEmailPane already keeps.
  const touched = useRef(false);

  const isEmail = spec.kind === 'email';
  const requestId = useRef(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID() : String(Date.now()),
  );

  // ---- the dry run, and the draft if this action carries one -----------
  useEffect(() => {
    let alive = true;
    void (async () => {
      setChecking(true);
      setError(null);
      try {
        const res = await run({
          propertyId: deal.propertyId,
          action,
          phase: 'check',
          ...(spec.draftKind ? { draft: { kind: spec.draftKind } } : {}),
        });
        if (!alive) return;
        setReport(res.report);
        setSendTo(res.sendTo ?? null);
        setSendToEvidence(res.sendToEvidence ?? null);
        setWillAttachProof(res.willAttachProof === true);
        setAfterSuggested(res.afterMove?.suggested ?? null);
        if (res.draft && !touched.current) {
          setSubject(res.draft.subject ?? '');
          setBody(res.draft.body ?? '');
        }
        // The callback slot the brain read off Pedro's call note, prefilled
        // in local wall-clock for the datetime input. Editable either way.
        if (res.suggestedDueAt && !dueAt) {
          const t = new Date(res.suggestedDueAt);
          const pad = (n: number) => String(n).padStart(2, '0');
          setDueAt(`${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Could not run the checks');
      } finally {
        if (alive) setChecking(false);
      }
    })();
    return () => { alive = false; };
  }, [deal.propertyId, action, run, spec.draftKind]);

  // ---- THE TIME IS PART OF THE CHECK, so changing it re-runs the check ---
  //
  // Hugo, 17 Aug, with a valid date in the box and a dead button: "when I
  // choose the time, the button to confirm is inactive."
  //
  // The dry run above fires ONCE, on open, and sent no time at all, so
  // book_followup opened already blocked and nothing typed into the field could
  // clear it. The block was real (no time had been picked) and permanent (the
  // server was never asked again). Booking a follow up from the cockpit was
  // impossible from the day the button shipped.
  //
  // The server stays the fence: this asks it again with the time, it does not
  // decide anything here. Debounced, because a datetime input fires on every
  // digit.
  const dueSeq = useRef(0);
  useEffect(() => {
    if (!TIMED_ACTIONS.includes(action) || !dueAt) return undefined;
    const iso = new Date(dueAt);
    if (Number.isNaN(iso.getTime())) return undefined;
    const seq = ++dueSeq.current;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await run({
            propertyId: deal.propertyId, action, phase: 'check', dueAt: iso.toISOString(),
          });
          // Only the newest answer counts: a slow reply about an old time must
          // never overwrite the verdict on the time now in the box.
          if (seq === dueSeq.current) setReport(res.report);
        } catch {
          // The verdict from the open check stands. A failed re-check must not
          // silently unlock a button.
        }
      })();
    }, 300);
    return () => clearTimeout(timer);
  }, [dueAt, action, deal.propertyId, run]);

  // ---- re-check the FINAL edited text, which is the version that goes ---
  //
  // `asFinal` is passed explicitly rather than read off state, because the
  // checkbox calls this in the same tick it sets the state and would otherwise
  // send the stale value. Every OTHER caller passes the current state, or
  // editing the body after ticking the box would quietly re-block the send.
  const recheckSeq = useRef(0);
  const recheck = useCallback(async (asFinal: boolean) => {
    if (!isEmail) return;
    // ONLY THE NEWEST ANSWER COUNTS. Ticking "best and final" blurs the
    // textarea, so the blur fires a recheck WITHOUT the flag in the same
    // breath as the tick fires one WITH it, and whichever response landed
    // last used to win. Hugo ticked the box and watched the red block stay
    // (17 Aug, "not clickable"): the un-flagged answer had arrived second.
    const seq = ++recheckSeq.current;
    try {
      const res = await run({
        propertyId: deal.propertyId,
        action: 'send_email',
        phase: 'check',
        draft: { subject, body, kind: spec.draftKind },
        ...(asFinal ? { finalOffer: true } : {}),
      });
      if (seq === recheckSeq.current) setReport(res.report);
    } catch { /* the existing report stands */ }
  }, [isEmail, run, deal.propertyId, subject, body, spec.draftKind]);

  // The destination as it stands: the human's pick, else the suggestion when
  // the board has that column, else "stays where it is". Resolved at render so
  // the check effect never has to depend on the stages array (a fresh array
  // every render, which would re-fire the checks for ever).
  const suggestedAfterId = afterSuggested
    ? stages.find((s) => s.name === afterSuggested)?.id ?? null : null;
  const effectiveAfter = afterChoice || suggestedAfterId || 'stay';
  const afterName = effectiveAfter === 'stay'
    ? null : stages.find((s) => s.id === effectiveAfter)?.name ?? null;

  const blocked = report ? !report.ok : false;
  const firstBlock = report?.checks.find((c) => c.level === 'block') ?? null;
  // THE ONE BLOCK A DELIBERATE DECISION CAN CLEAR, and only Hugo's.
  //
  // The ceiling never goes in writing, which is right, and it also made a best
  // and final email impossible: on Zest Hull the top rung of the ladder IS the
  // number the branch is waiting on, so every draft tripped the fence and the
  // send button could never light up.
  //
  // Ticking this does NOT unlock the button here. It asks the SERVER again with
  // the flag set, and the server decides, and only for an admin. An agent who
  // ticks it gets the same block back, which is the point.
  // Hidden from an agent entirely: the server would refuse him anyway, and a
  // box that does nothing when you tick it is worse than no box.
  const ceilingBlocked = firstBlock?.id === 'ceiling_not_in_writing' && isAdmin;
  const warned = (report?.warned.length ?? 0) > 0;
  const needsStage = action === 'move_stage' && !columnId;
  // Confirming a ballpark ALWAYS books Pedro's callback, or the card would
  // sit on the desk as an already-made decision. The field arrives prefilled
  // from the call note; it can be edited, never cleared.
  // Both actions that carry a time need one before the button lives. It said
  // fetch_ballpark only, so book_followup relied on the server's block, which
  // never re-ran, which is the bug above.
  const needsDue = (action === 'fetch_ballpark' || action === 'book_followup') && !dueAt;
  const canCommit = !checking && !committing && !blocked && !needsStage && !needsDue
    && (!warned || acknowledged);

  const commit = useCallback(async () => {
    setCommitting(true);
    setError(null);
    try {
      const res = await run({
        propertyId: deal.propertyId,
        action: isEmail ? 'send_email' : action,
        phase: 'press',
        requestId: requestId.current,
        ...(isEmail ? { draft: { subject, body, kind: spec.draftKind } } : {}),
        ...(note ? { note } : {}),
        // datetime-local carries NO timezone; sent raw, Postgres read it as
        // UTC, and Hugo's 10:31 UK booking landed at 11:31 UK (17 Aug, Grove
        // Avenue). new Date() parses it as local wall time; the ISO is true.
        ...(dueAt ? { dueAt: new Date(dueAt).toISOString() } : {}),
        ...(columnId ? { columnId } : {}),
        // Carried into the PRESS too. The press re-runs the whole stress test
        // server-side, so without this the ceiling fence would refuse the very
        // send the human just deliberately approved.
        ...(finalOffer ? { finalOffer: true } : {}),
      });

      // A refusal is HTTP 200. It is the gate working, not an error.
      if (!res.ok) {
        setReport(res.report);
        setError(res.detail ?? 'The checks refused this one.');
        return;
      }

      // ---- the two the browser has to finish itself -------------------
      if (res.execute?.how === 'client') {
        if (res.execute.via.includes('wk-email-send')) {
          const { error: sendErr } = await supabase.functions.invoke('wk-email-send', {
            body: res.execute.payload,
          });
          await run({
            propertyId: deal.propertyId, action: 'send_email', phase: 'record',
            outcome: sendErr ? { ok: false, error: String(sendErr) } : { ok: true },
            // The destination the human chose at the gate. 'stay' travels as
            // an explicit null: a veto on the default move, not an absence.
            afterColumnId: effectiveAfter === 'stay' ? null : effectiveAfter,
          }).catch(() => undefined);
          if (sendErr) { setError(`The email did not send: ${String(sendErr)}`); return; }
        } else if (res.execute.via.includes('call') && deal.contactId) {
          onCall(deal.contactId);
          await run({
            propertyId: deal.propertyId, action: 'call_branch', phase: 'record',
            outcome: { ok: true },
          }).catch(() => undefined);
        }
      }

      onCommitted();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not go through');
    } finally {
      setCommitting(false);
    }
  }, [run, deal.propertyId, deal.contactId, action, isEmail, subject, body, note, dueAt, columnId, effectiveAfter, finalOffer, spec.draftKind, onCommitted, onCall]);

  // Escape cancels. The commit button never takes autofocus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div className="absolute inset-0" onClick={onCancel} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        data-testid="cockpit-confirm"
        className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-border bg-surface shadow-pop sm:rounded-2xl"
      >
        <div className="flex flex-shrink-0 items-start gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-[14px] font-bold text-ink">{spec.label}</h3>
            {/* REGION 1: the exact thing about to happen. */}
            <p className="mt-0.5 text-[12px] text-ink-muted" data-testid="cockpit-confirm-sentence">
              {confirmSentence(action, deal)}
            </p>
          </div>
          <button type="button" onClick={onCancel} className="rounded p-1 text-ink-subtle hover:bg-elevated">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {/* REGION 2: the stress test, as it reads RIGHT NOW. */}
          {checking ? (
            <div className="flex items-center gap-2 text-[12px] text-ink-muted">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Running the checks
            </div>
          ) : report ? (
            <StressTestList checks={report.checks} />
          ) : null}

          {/* the position on price, worked out in code before anything is sent */}
          {report?.counter && (
            <div className="rounded-md border border-border bg-elevated px-2.5 py-2 text-[11.5px] text-ink">
              <strong className="font-semibold">
                {report.counter.position === 'raise' ? 'We can move' : `The answer is to ${report.counter.position}`}
              </strong>{' '}
              {report.counter.reason}
            </div>
          )}

          {/* THE MONEY IF THIS GOES THROUGH. Admin only, same boundary as the
              calculator in the calls drawer: Pedro executes, Hugo approves
              with the breakdown in front of him. Every figure is READ off the
              file; the one subtraction is labelled for what it leaves out. */}
          {isAdmin && MONEY_GATE_ACTIONS.includes(action)
            && (deal.money.gdv !== null || deal.money.open !== null) && (
            <div className="rounded-md border border-border bg-white px-2.5 py-2" data-testid="cockpit-money-breakdown">
              <span className="text-[10px] font-bold uppercase tracking-wider text-ink-subtle">
                The money if this goes through
              </span>
              <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11.5px]">
                {([
                  ['Asking', deal.money.asking],
                  ['Buy at', report?.counter?.newOffer ?? deal.money.open],
                  ['Walk away above', deal.money.pinnedCeiling ?? deal.money.ceiling],
                  ['Works', deal.money.refurb],
                  ['Worth today', deal.money.tmv],
                  ['Done up', deal.money.gdv],
                ] as const).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-ink-subtle">{k}</dt>
                    <dd className="text-ink tabular-nums">{v === null || v === undefined ? 'not on file' : gbpShort(v)}</dd>
                  </div>
                ))}
                {deal.money.gdv !== null
                  && (report?.counter?.newOffer ?? deal.money.ceiling) !== null && (
                  <div className="contents">
                    <dt className="font-semibold text-ink">The gap</dt>
                    <dd className="font-semibold text-ink tabular-nums">
                      {gbpShort(deal.money.gdv
                        - (report?.counter?.newOffer ?? deal.money.ceiling ?? 0)
                        - (deal.money.refurb ?? 0))}
                      <span className="ml-1 font-normal text-[10px] text-ink-subtle">before finance, fees and stamp duty</span>
                    </dd>
                  </div>
                )}
              </dl>
              {deal.money.refurbAssumed && (
                <p className="mt-1 text-[10.5px] text-[#B45309]">
                  The works figure is a stand-in, nobody has read the condition yet. The ballpark prices the real works.
                </p>
              )}
            </div>
          )}

          {/* REGION 3: what is actually about to be sent or written. */}
          {isEmail && (
            <div className="space-y-2">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-ink-subtle">To</span>
                <p className="text-[12px] text-ink" data-testid="cockpit-send-to">
                  {sendTo ?? deal.branchEmail ?? 'no address on file'}
                </p>
                {/* WHERE THE ADDRESS CAME FROM. Shown whenever it did not come
                    off the branch card, because an offer emailed to the wrong
                    branch is worse than one not sent. */}
                {sendToEvidence && (
                  <p className="mt-0.5 rounded border border-[#A7F3D0] bg-[#ECFDF5] px-1.5 py-1 text-[10.5px] text-[#047857]">
                    {sendToEvidence}
                  </p>
                )}
              </div>
              {willAttachProof && (
                <div
                  className="flex items-center gap-1.5 rounded-md border border-[#BFDBFE] bg-[#EFF6FF] px-2 py-1.5 text-[11px] text-[#1D4ED8]"
                  data-testid="cockpit-attachment"
                >
                  <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0" />
                  Our proof of funds goes with this email. The link is minted when you press send and dies in an hour.
                </div>
              )}
              <label className="block">
                <span className="text-[10px] font-bold uppercase tracking-wider text-ink-subtle">Subject</span>
                <input
                  value={subject}
                  onChange={(e) => { touched.current = true; setSubject(e.target.value); }}
                  onBlur={() => void recheck(finalOffer)}
                  className="mt-0.5 w-full rounded-md border border-border bg-white px-2 py-1.5 text-[12px] text-ink"
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-bold uppercase tracking-wider text-ink-subtle">Message</span>
                <textarea
                  value={body}
                  onChange={(e) => { touched.current = true; setBody(e.target.value); }}
                  onBlur={() => void recheck(finalOffer)}
                  rows={9}
                  className="mt-0.5 w-full rounded-md border border-border bg-white px-2 py-1.5 text-[12px] leading-snug text-ink"
                />
              </label>
              {/* WHERE THE CARD LANDS, chosen here instead of moving behind
                  the human's back. Hugo, 17 Aug: "it shows the suggested
                  column... and also gives me the drop down if I wanna choose
                  a different one." */}
              <label className="block">
                <span className="text-[10px] font-bold uppercase tracking-wider text-ink-subtle">
                  After it sends, the card moves to
                </span>
                <select
                  value={effectiveAfter}
                  onChange={(e) => setAfterChoice(e.target.value)}
                  data-testid="cockpit-after-move"
                  className="mt-0.5 w-full rounded-md border border-border bg-white px-2 py-1.5 text-[12px] text-ink"
                >
                  <option value="stay">
                    Stays in {deal.column ?? 'its stage'}
                  </option>
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.name === afterSuggested ? ' (suggested)' : ''}
                      {s.name === deal.column ? ' (it is here now)' : ''}
                    </option>
                  ))}
                </select>
                {afterName === 'Waiting on their answer' && (
                  <span className="mt-0.5 block text-[10.5px] text-ink-subtle">
                    A chase call is booked for 3 days from now if they go quiet.
                  </span>
                )}
              </label>
            </div>
          )}

          {/* The fixed destinations, said out loud before the press. */}
          {!isEmail && afterSuggested && (
            <p
              className="rounded-md border border-border bg-elevated px-2.5 py-2 text-[11.5px] text-ink"
              data-testid="cockpit-after-move-note"
            >
              After this, the card moves to <strong className="font-semibold">{afterSuggested}</strong>.
            </p>
          )}

          {/* MOVING A CARD, BY HAND. The stages come from the server, and the
              one it is in now is marked so nobody moves it to where it
              already is. */}
          {action === 'move_stage' && (
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-wider text-ink-subtle">
                Move it to
              </span>
              <select
                value={columnId}
                onChange={(e) => setColumnId(e.target.value)}
                data-testid="cockpit-stage-picker"
                className="mt-0.5 w-full rounded-md border border-border bg-white px-2 py-1.5 text-[12px] text-ink"
              >
                <option value="">Pick a stage</option>
                {stages.map((s) => (
                  <option key={s.id} value={s.id} disabled={s.name === deal.column}>
                    {s.name}{s.name === deal.column ? ' (it is here now)' : ''}
                  </option>
                ))}
              </select>
              {/* WHAT THE MOVE DOES, said before the press. Hugo, 17 Aug:
                  "when I move a lead to a pipeline column, that's it." The card
                  leaves the desk on the move alone, with no time on it, so the
                  sentence has to say what brings it back. */}
              {columnId && (
                <p className="mt-1.5 text-[11px] text-ink-subtle" data-testid="cockpit-move-clears-desk">
                  This takes it off the cockpit. It stays on the board where you put
                  it, and comes back if they write or a follow up comes due.
                </p>
              )}
            </label>
          )}

          {/* THE APPROVAL DESK. The machine already ran the homework; the
              gate shows what came back and the callback slot it read off the
              call, prefilled. One press: band armed, card moved, Pedro
              booked, and the deal leaves the cockpit until the callback. */}
          {action === 'fetch_ballpark' && deal.ballpark?.ran && (
            <div className="rounded-md border border-border bg-elevated px-2.5 py-2 text-[11.5px] text-ink" data-testid="cockpit-ballpark-result">
              {deal.ballpark.ok ? (
                <>
                  <strong className="font-semibold">I ran the ballpark.</strong>{' '}
                  {deal.ballpark.refurb
                    ? `Works ${gbpShort(deal.ballpark.refurb)}, open`
                    : 'No works cost recorded. Open'}{' '}
                  at {gbpShort(deal.ballpark.open ?? 0)},
                  worth {gbpShort(deal.ballpark.gdv ?? 0)} done up on {deal.ballpark.tier ?? 'ungraded'} comps.
                  The ceiling stays in the room.
                </>
              ) : (
                <>
                  <strong className="font-semibold">The engine will not put a figure on this yet.</strong>{' '}
                  {deal.ballpark.refusalDetail || deal.ballpark.refusal}
                </>
              )}
            </div>
          )}

          {(action === 'book_followup' || action === 'fetch_ballpark') && (
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-wider text-ink-subtle">
                {action === 'fetch_ballpark' ? 'Book Pedro to ring back' : 'When'}
              </span>
              <input
                type="datetime-local"
                value={dueAt}
                required={action === 'fetch_ballpark'}
                onChange={(e) => setDueAt(e.target.value)}
                className="mt-0.5 w-full rounded-md border border-border bg-white px-2 py-1.5 text-[12px] text-ink"
              />
              {needsDue && (
                <span className="mt-0.5 block text-[10.5px] text-[#B45309]">
                  Pick when Pedro rings back. Confirming books the callback and takes the card off the desk.
                </span>
              )}
            </label>
          )}

          {(action === 'add_note' || action === 'escalate_hugo' || action === 'hold') && (
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-wider text-ink-subtle">
                {action === 'escalate_hugo' ? 'What Hugo needs to know' : 'Note'}
              </span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                placeholder={action === 'escalate_hugo' ? deal.instruction : ''}
                className="mt-0.5 w-full rounded-md border border-border bg-white px-2 py-1.5 text-[12px] text-ink"
              />
            </label>
          )}
        </div>

        <div className="flex-shrink-0 border-t border-border px-4 py-3">
          {/* THE REASON, VERBATIM, right above the button it disabled. */}
          {firstBlock && (
            <p
              className="mb-2 flex items-start gap-1.5 text-[11.5px] leading-snug text-[#DC2626]"
              data-testid="cockpit-confirm-blocked"
            >
              <ShieldAlert className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>{firstBlock.detail}</span>
            </p>
          )}

          {error && !firstBlock && (
            <p className="mb-2 text-[11.5px] text-[#DC2626]">{error}</p>
          )}

          {ceilingBlocked && (
            <label
              className="mb-2 flex items-start gap-1.5 text-[11.5px] text-[#B91C1C]"
              data-testid="cockpit-final-offer"
            >
              <input
                type="checkbox"
                checked={finalOffer}
                onChange={(e) => {
                  setFinalOffer(e.target.checked);
                  // Accepting "our maximum goes in writing, no climb left" IS
                  // reading the warnings: the cleared block comes back as a
                  // warning, and demanding a second, blander tick right after
                  // this one is how the button stayed grey on a decision the
                  // human had already made.
                  if (e.target.checked) setAcknowledged(true);
                  // The SERVER decides, every time, from the caller's own token.
                  void recheck(e.target.checked);
                }}
                className="mt-0.5"
              />
              <span>
                This is our best and final on this house. I accept the branch will
                have our maximum in writing and there is no climb left afterwards.
              </span>
            </label>
          )}

          {!blocked && warned && (
            <label className="mb-2 flex items-start gap-1.5 text-[11.5px] text-[#C2410C]">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="mt-0.5"
              />
              <span>I have read the warnings above.</span>
            </label>
          )}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg px-3 py-1.5 text-[12px] text-ink-muted hover:bg-elevated"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void commit()}
              disabled={!canCommit}
              data-testid="cockpit-confirm-commit"
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white',
                canCommit ? 'bg-brand hover:bg-brand-700' : 'bg-[#9CA3AF] cursor-not-allowed',
              )}
            >
              {committing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {warned && !blocked ? `${commitVerbFor(action, isAdmin)} anyway` : commitVerbFor(action, isAdmin)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
