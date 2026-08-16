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
import { Loader2, ShieldAlert, X } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { supabase } from '@/integrations/supabase/browser';
import { useAuth } from '../../lib/useCrmAuth';
import { gbpShort } from '../../../../../api/lib/brrr-offer';
import StressTestList from './StressTestList';
import { COCKPIT_ACTIONS, confirmSentence, type CockpitAction } from './cockpitActions';
import { useCockpitAction } from '../../hooks/useCockpit';
import type { CockpitDeal, StressReport } from './types';

/** The actions where money changes hands or a figure is committed to, so the
 *  approval shows the breakdown. Hugo, 16 Aug: "the AI decides, but I approve
 *  ... and then it shows me the breakdown of how much money gonna make." */
const MONEY_GATE_ACTIONS: CockpitAction[] = [
  'fetch_ballpark', 'draft_offer_email', 'draft_counter_reply', 'move_stage',
];

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

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [note, setNote] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [columnId, setColumnId] = useState('');
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

  // ---- re-check the FINAL edited text, which is the version that goes ---
  const recheck = useCallback(async () => {
    if (!isEmail) return;
    try {
      const res = await run({
        propertyId: deal.propertyId,
        action: 'send_email',
        phase: 'check',
        draft: { subject, body, kind: spec.draftKind },
      });
      setReport(res.report);
    } catch { /* the existing report stands */ }
  }, [isEmail, run, deal.propertyId, subject, body, spec.draftKind]);

  const blocked = report ? !report.ok : false;
  const firstBlock = report?.checks.find((c) => c.level === 'block') ?? null;
  const warned = (report?.warned.length ?? 0) > 0;
  const needsStage = action === 'move_stage' && !columnId;
  // Confirming a ballpark ALWAYS books Pedro's callback, or the card would
  // sit on the desk as an already-made decision. The field arrives prefilled
  // from the call note; it can be edited, never cleared.
  const needsDue = action === 'fetch_ballpark' && !dueAt;
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
  }, [run, deal.propertyId, deal.contactId, action, isEmail, subject, body, note, dueAt, columnId, spec.draftKind, onCommitted, onCall]);

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
                <p className="text-[12px] text-ink">{deal.branchEmail ?? 'no address on file'}</p>
              </div>
              <label className="block">
                <span className="text-[10px] font-bold uppercase tracking-wider text-ink-subtle">Subject</span>
                <input
                  value={subject}
                  onChange={(e) => { touched.current = true; setSubject(e.target.value); }}
                  onBlur={() => void recheck()}
                  className="mt-0.5 w-full rounded-md border border-border bg-white px-2 py-1.5 text-[12px] text-ink"
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-bold uppercase tracking-wider text-ink-subtle">Message</span>
                <textarea
                  value={body}
                  onChange={(e) => { touched.current = true; setBody(e.target.value); }}
                  onBlur={() => void recheck()}
                  rows={9}
                  className="mt-0.5 w-full rounded-md border border-border bg-white px-2 py-1.5 text-[12px] leading-snug text-ink"
                />
              </label>
            </div>
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
              {warned && !blocked ? `${spec.commitVerb} anyway` : spec.commitVerb}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
