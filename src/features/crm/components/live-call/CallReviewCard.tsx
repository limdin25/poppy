// The AI review of the call that just ended, on the wrap-up card.
//
// Hugo 2026-08-12: "give an AI report as well, after every call. What he done
// wrong."
//
// Fetches once per call id, on the transcript of the call that has just been
// hung up. It marks the call against the rules in the property script, the same
// ones the live coach works to. Blunt on purpose: this is the bit that makes
// the next call better.
//
// It never blocks anything. If there is no transcript, or the model is having a
// bad day, the card says so in one line and the agent carries on.

import { useEffect, useState } from 'react';
import { Sparkles, Check, X, Loader2, ChevronDown, GraduationCap } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { useAuth } from '@/features/crm/lib/useCrmAuth';

interface Review {
  verdict?: string;
  score?: number;
  gotTheFigure?: boolean;
  gotTheEmail?: boolean;
  gotACallback?: boolean;
  wentWell?: string[];
  mistakes?: { what: string; shouldHaveSaid?: string }[];
  nextCall?: string;
  skipped?: boolean;
  reason?: string;
}

function Tick({ ok, label }: { ok?: boolean; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold',
        ok ? 'bg-[#E8F5EC] text-[#1F5C33]' : 'bg-[#FEF2F2] text-[#991B1B]',
      )}
    >
      {ok ? <Check className="h-2.5 w-2.5" /> : <X className="h-2.5 w-2.5" />}
      {label}
    </span>
  );
}

export default function CallReviewCard({ callId }: { callId: string | null }) {
  const { user } = useAuth();
  const agentKey = user?.id ?? 'unknown';
  const [review, setReview] = useState<Review | null>(null);
  // How many of this call's mistakes were queued as questions. Hugo 2026-08-12:
  // the checkpoint should ask about HIS mistakes, not a random topic.
  const [queued, setQueued] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (!callId) return;
    let cancelled = false;
    // Same reason as KnowledgeCheckpoint: the state resets happen on the next
    // tick rather than synchronously in the effect body.
    const t = setTimeout(() => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
      setReview(null);
      void run();
    }, 0);
    const run = async () => {
      try {
        const res = await fetch('/api/crm/call-review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callId }),
        });
        const data = (await res.json()) as Review & { error?: string };
        if (cancelled) return;
        if (!res.ok) { setError(data.error ?? 'No review for this one.'); return; }
        setReview(data);

        // Queue what went wrong, so the next checkpoint asks about it. The
        // unique index on (agent, call, question) makes a repeat mount a no-op,
        // so this cannot stack up the same mistake twice.
        const mistakes = (data.mistakes ?? [])
          .map((m) => `${m.what} ${m.shouldHaveSaid ?? ''}`)
          .join(' ')
          .trim();
        if (!mistakes) return;
        try {
          const q = await fetch('/api/crm/knowledge-check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'flag', agentKey, callId, mistakes }),
          });
          const qd = (await q.json()) as { queued?: number };
          if (!cancelled) setQueued(qd.queued ?? 0);
        } catch {
          // Queuing practice is a bonus. Never let it break the review.
        }
      } catch {
        if (!cancelled) setError('No review for this one.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    return () => { cancelled = true; clearTimeout(t); };
  }, [callId, agentKey]);

  if (!callId) return null;

  return (
    <div className="border-t border-[#E5E7EB] px-4 py-2.5" data-testid="call-review">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 text-left"
        aria-expanded={open}
      >
        <Sparkles className="h-3.5 w-3.5 flex-shrink-0 text-[#3C5A87]" />
        <span className="text-[11px] font-bold uppercase tracking-wide text-[#3C5A87]">
          How that call went
        </span>
        {loading && <Loader2 className="h-3 w-3 animate-spin text-[#9CA3AF]" />}
        {typeof review?.score === 'number' && (
          <span className="ml-auto text-[11px] font-bold tabular-nums text-[#1A1A1A]">
            {review.score}/10
          </span>
        )}
        <ChevronDown className={cn('h-3 w-3 flex-shrink-0 text-[#6B7280] transition-transform', !open && '-rotate-90')} />
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {loading && <p className="text-[12px] text-[#9CA3AF]">Listening back to it…</p>}
          {error && !loading && <p className="text-[12px] text-[#9CA3AF]">{error}</p>}
          {review?.skipped && (
            <p className="text-[12px] text-[#9CA3AF]">{review.reason}</p>
          )}

          {review && !review.skipped && (
            <>
              {review.verdict && (
                <p className="text-[12px] leading-snug text-[#1A1A1A]">{review.verdict}</p>
              )}

              <div className="flex flex-wrap gap-1">
                <Tick ok={review.gotTheFigure} label="figure" />
                <Tick ok={review.gotTheEmail} label="email" />
                <Tick ok={review.gotACallback} label="callback" />
              </div>

              {(review.mistakes?.length ?? 0) > 0 && (
                <div className="rounded-lg bg-[#FEF2F2] px-2 py-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[#991B1B]">
                    What went wrong
                  </p>
                  <ul className="mt-1 space-y-1.5">
                    {review.mistakes!.map((m) => (
                      <li key={m.what} className="text-[11px] leading-snug text-[#1A1A1A]">
                        {m.what}
                        {m.shouldHaveSaid && (
                          <span className="mt-0.5 block text-[#6B7280]">
                            Say instead: &ldquo;{m.shouldHaveSaid}&rdquo;
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {(review.wentWell?.length ?? 0) > 0 && (
                <ul className="space-y-0.5">
                  {review.wentWell!.map((w) => (
                    <li key={w} className="flex items-start gap-1 text-[11px] leading-snug text-[#1F5C33]">
                      <Check className="mt-0.5 h-3 w-3 flex-shrink-0" /> {w}
                    </li>
                  ))}
                </ul>
              )}

              {queued > 0 && (
                <p className="flex items-start gap-1 text-[10px] leading-snug text-[#6B7280]">
                  <GraduationCap className="mt-0.5 h-3 w-3 flex-shrink-0" />
                  {queued === 1 ? 'This is' : `${queued} of these are`} going into your next
                  knowledge check.
                </p>
              )}

              {review.nextCall && (
                <div className="rounded-lg bg-[#EEF2F8] px-2 py-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[#3C5A87]">
                    On the next dial
                  </p>
                  <p className="text-[11px] leading-snug text-[#1A1A1A]">{review.nextCall}</p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
