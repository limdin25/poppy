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
import StressTestList from './StressTestList';
import { COCKPIT_ACTIONS, confirmSentence, type CockpitAction } from './cockpitActions';
import { useCockpitAction } from '../../hooks/useCockpit';
import type { CockpitDeal, StressReport } from './types';

interface Props {
  deal: CockpitDeal;
  action: CockpitAction;
  onCancel: () => void;
  onCommitted: () => void;
  /** Opens the CRM's one call room over the cockpit and dials. */
  onCall: (contactId: string) => void;
}

export default function ActionConfirmDialog({ deal, action, onCancel, onCommitted, onCall }: Props) {
  const spec = COCKPIT_ACTIONS[action];
  const { run } = useCockpitAction();

  const [report, setReport] = useState<StressReport | null>(null);
  const [checking, setChecking] = useState(true);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [note, setNote] = useState('');
  const [dueAt, setDueAt] = useState('');
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
  const canCommit = !checking && !committing && !blocked && (!warned || acknowledged);

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
        ...(dueAt ? { dueAt } : {}),
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
  }, [run, deal.propertyId, deal.contactId, action, isEmail, subject, body, note, dueAt, spec.draftKind, onCommitted, onCall]);

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

          {action === 'book_followup' && (
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-wider text-ink-subtle">When</span>
              <input
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                className="mt-0.5 w-full rounded-md border border-border bg-white px-2 py-1.5 text-[12px] text-ink"
              />
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
