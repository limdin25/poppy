// Read the message before it goes, then choose which one goes.
//
// Hugo, 2026-08-24: "he can click and say send message and then it shows the
// opener message ... and make sure he can choose the template he wants to
// send."
//
// This is deliberately a modal with its own button rather than an inline
// confirm. It is the last thing between a press and a cold WhatsApp landing on
// a real builder's phone, and everything that can refuse the send is shown here
// rather than discovered afterwards: an unapproved template, a missing house
// number, the house-level block, and how much of today's cap is left.

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { callWaAdmin, isApproved, renderTemplate, type MetaTemplate } from '../../lib/waAdmin';
import { prefillTemplateVars } from '../../lib/waTemplates';

interface Props {
  open: boolean;
  onClose: () => void;
  recipients: Array<{ id: string; name: string; phone: string | null }>;
  facts: { address: string; viewingTime: string; sender: string };
  houseNumberKnown: boolean;
  blockedReason: string | null;
  sentToday: number;
  dailyCap: number;
  onSend: (contentSid: string, vars: Record<string, string>) => Promise<void>;
}

export default function SendReviewDialog({
  open, onClose, recipients, facts, houseNumberKnown,
  blockedReason, sentToday, dailyCap, onSend,
}: Props) {
  const [templates, setTemplates] = useState<MetaTemplate[]>([]);
  const [sid, setSid] = useState('');
  const [vars, setVars] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setLoadError(null);
    callWaAdmin<{ templates: MetaTemplate[] }>({ action: 'template_list' })
      .then((r) => {
        if (!alive) return;
        // Only approved templates are offered. Meta refuses the rest at the
        // wire anyway, and sendOutreachRow checks approval again before it
        // spends, so offering one would only produce a confusing refusal.
        const ok = (r.templates ?? []).filter(isApproved);
        setTemplates(ok);
        if (ok.length && !sid) setSid(ok[0].sid);
      })
      .catch((e) => { if (alive) setLoadError(e instanceof Error ? e.message : 'Could not load the templates.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, sid]);

  const chosen = useMemo(() => templates.find((t) => t.sid === sid) ?? null, [templates, sid]);

  useEffect(() => {
    if (!chosen) return;
    setVars(prefillTemplateVars(chosen.body, {
      address: facts.address, viewingTime: facts.viewingTime, sender: facts.sender,
    }));
  }, [chosen, facts.address, facts.viewingTime, facts.sender]);

  if (!open) return null;

  const preview = chosen ? renderTemplate(chosen.body, vars) : '';
  const blanks = chosen ? Object.entries(vars).filter(([, v]) => !v.trim()) : [];
  const room = Math.max(0, dailyCap - sentToday);
  const overCap = recipients.length > room;
  const canSend = Boolean(chosen) && !blanks.length && !blockedReason && !overCap && !sending;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl" data-testid="send-review-dialog">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h2 className="text-[14px] font-semibold text-[#1A1A1A]">
              Send to {recipients.length} builder{recipients.length === 1 ? '' : 's'}
            </h2>
            <p className="mt-0.5 text-[11px] text-[#6B7280]">Read it before it goes.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-[#9CA3AF] hover:bg-[#F3F4F6]">
            <X className="h-4 w-4" />
          </button>
        </div>

        {blockedReason ? (
          <Warn>This house cannot have builders invited yet. Clear the block above first.</Warn>
        ) : null}
        {!houseNumberKnown ? (
          <Warn>
            There is still no house number on this advert. They will be told the street only, and the last
            time that happened the builder asked which house it was and never got an answer.
          </Warn>
        ) : null}
        {overCap ? (
          <Warn>
            Only {room} of today&apos;s {dailyCap} can still go out and you have {recipients.length} selected.
            Send fewer, or wait until tomorrow.
          </Warn>
        ) : null}

        <label className="mb-1 block text-[9.5px] font-bold uppercase tracking-wider text-[#9CA3AF]">Message</label>
        {loading ? (
          <div className="h-8 animate-pulse rounded-[8px] bg-[#F3F4F6]" />
        ) : loadError ? (
          <p className="text-[11.5px] text-[#DC2626]">{loadError}</p>
        ) : !templates.length ? (
          <p className="text-[11.5px] text-[#B45309]">
            No approved WhatsApp template exists yet, so nothing can be sent to a builder outside a live
            conversation.
          </p>
        ) : (
          <select
            data-testid="send-template-picker"
            value={sid}
            onChange={(e) => setSid(e.target.value)}
            className="mb-2 w-full rounded-[8px] border border-[#E5E7EB] bg-white px-2 py-1.5 text-[12px] text-[#1A1A1A] focus:outline-none focus:ring-1 focus:ring-[#3C5A87]"
          >
            {templates.map((t) => <option key={t.sid} value={t.sid}>{t.name}</option>)}
          </select>
        )}

        {chosen ? (
          <>
            <div className="whitespace-pre-wrap rounded-[10px] border border-[#E5E7EB] bg-[#FAFAF8] px-3 py-2 text-[12px] leading-relaxed text-[#1A1A1A]">
              {preview}
            </div>
            {blanks.length ? (
              <div className="mt-2 space-y-1.5">
                <p className="text-[11px] text-[#B45309]">
                  Fill these in. They are left empty rather than guessed, because a wrong address is a builder
                  at the wrong house.
                </p>
                {blanks.map(([n]) => (
                  <input
                    key={n}
                    value={vars[n] ?? ''}
                    onChange={(e) => setVars((v) => ({ ...v, [n]: e.target.value }))}
                    placeholder={`Blank ${n}`}
                    className="w-full rounded-[8px] border border-[#F59E0B] bg-white px-2 py-1 text-[12px] focus:outline-none focus:ring-1 focus:ring-[#3C5A87]"
                  />
                ))}
              </div>
            ) : null}
          </>
        ) : null}

        <div className="mt-3 max-h-28 overflow-y-auto rounded-[10px] border border-[#E5E7EB]">
          {recipients.map((r) => (
            <div key={r.id} className="flex items-center justify-between border-b border-[#F3F4F6] px-2 py-1 last:border-b-0">
              <span className="truncate text-[11.5px] text-[#374151]">{r.name}</span>
              <span className="font-mono text-[11px] tabular-nums text-[#9CA3AF]">{r.phone}</span>
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-[10.5px] text-[#6B7280]">{sentToday} of {dailyCap} sent today</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-[8px] border border-[#E5E7EB] bg-white px-3 py-1.5 text-[11.5px] font-medium text-[#6B7280]">
              Cancel
            </button>
            <button
              data-testid="send-review-confirm"
              disabled={!canSend}
              onClick={async () => {
                if (!chosen) return;
                setSending(true);
                try { await onSend(chosen.sid, vars); } finally { setSending(false); }
              }}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[11.5px] font-bold text-white',
                canSend ? 'bg-[#2E7D46]' : 'bg-[#9CA3AF]',
              )}
            >
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Send it
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-start gap-1.5 rounded-[10px] border border-[#F59E0B] bg-[#FFFBEB] px-2.5 py-1.5">
      <AlertTriangle className="mt-[2px] h-3 w-3 flex-shrink-0 text-[#B45309]" />
      <span className="text-[11px] text-[#B45309]">{children}</span>
    </div>
  );
}
