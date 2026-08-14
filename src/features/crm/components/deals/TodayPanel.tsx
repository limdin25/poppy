// The day, in the order it should be worked.
//
// docs/AI_DEAL_MANAGER_PLAN.md gap 5: "Pedro's day has a queue order but no
// priorities. The nightly assign script orders the queue once. During the day,
// overdue follow-ups, fresh branch replies, booked call-twos and new discovery
// calls all compete, and Pedro decides by eye."
//
// The order here is computed by code (api/lib/deal-manager-contract.ts
// baselineAttention), so it is right even with the Deal Manager switched off.
// A branch that has written to us and been ignored outranks everything, because
// that is the one that was actually costing money: Lexi's rejection sat unread
// for seven hours while a fresh offer was about to go out blind.

import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Mail, Clock, AlarmClock, ChevronRight } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { supabase } from '@/integrations/supabase/browser';

interface TodayItem {
  propertyId: string;
  address: string | null;
  column: string | null;
  attention: number;
  flags: string[];
  instruction: string;
  repliedSinceBrief: boolean;
  lastInboundPreview: string | null;
  hoursSinceTouch: number | null;
}

/** Plain English for the closed flag list, so nobody has to learn the codes. */
const FLAG_LABEL: Record<string, string> = {
  reply_unread: 'They replied',
  overdue_followup: 'Follow-up overdue',
  stale_no_touch: 'Nothing has happened',
  figure_mismatch: 'Figures disagree',
  stage_mismatch: 'Wrong column',
  price_cut_on_known_branch: 'Price cut',
  blocked_needs_hugo: 'Needs Hugo',
  pack_incomplete: 'Pack incomplete',
};

const FLAG_TONE: Record<string, string> = {
  reply_unread: 'bg-[#FEF2F2] text-[#DC2626] border-[#FECACA]',
  overdue_followup: 'bg-[#FFF7ED] text-[#C2410C] border-[#FED7AA]',
  stale_no_touch: 'bg-[#F3F4F6] text-[#4B5563] border-[#E5E7EB]',
};

function hours(h: number | null): string {
  if (h === null) return 'never touched';
  if (h < 1) return 'just now';
  if (h < 48) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default function TodayPanel({ onOpen }: { onOpen?: (propertyId: string) => void }) {
  const [items, setItems] = useState<TodayItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [managerOn, setManagerOn] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) throw new Error('Not signed in');
      const res = await fetch('/api/crm/deal-manager', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json() as {
        today?: TodayItem[]; managerEnabled?: boolean; error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? 'Could not load the day');
      setItems(json.today ?? []);
      setManagerOn(Boolean(json.managerEnabled));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the day');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-[14px] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#E5E7EB]">
        <div>
          <h2 className="text-[14px] font-semibold text-[#1A1A1A]">Today</h2>
          <p className="text-[11px] text-[#6B7280]">
            {managerOn
              ? 'Ordered by what needs a person most'
              : 'Ordered by what needs a person most. The deal brain is off, so this is the deterministic order.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#3C5A87] hover:text-[#3C5A87]/80 disabled:opacity-50"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 text-[12px] text-[#DC2626] bg-[#FEF2F2]">{error}</div>
      )}

      {!error && !loading && items.length === 0 && (
        <div className="px-4 py-8 text-center text-[12px] text-[#9CA3AF] italic">
          Nothing is waiting on anybody. Every deal has been touched recently and
          no branch is waiting on a reply.
        </div>
      )}

      <ul className="divide-y divide-[#F3F4F6]">
        {items.map((it) => (
          <li key={it.propertyId}>
            <button
              type="button"
              onClick={() => onOpen?.(it.propertyId)}
              className="w-full text-left px-4 py-3 hover:bg-[#F9FAFB] transition-colors"
            >
              <div className="flex items-start gap-3">
                {/* The score, so the order is never a mystery. */}
                <div
                  className={cn(
                    'flex-shrink-0 w-9 h-9 rounded-full grid place-items-center text-[12px] font-bold tabular-nums',
                    it.attention >= 70 ? 'bg-[#FEF2F2] text-[#DC2626]'
                      : it.attention >= 40 ? 'bg-[#FFF7ED] text-[#C2410C]'
                        : 'bg-[#F3F4F6] text-[#6B7280]',
                  )}
                  title={`Attention ${it.attention} of 100`}
                >
                  {it.attention}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[13px] font-semibold text-[#1A1A1A] truncate">
                      {it.address ?? 'Unnamed property'}
                    </span>
                    {it.column && (
                      <span className="text-[10px] text-[#6B7280] flex-shrink-0">
                        {it.column}
                      </span>
                    )}
                  </div>

                  <p className="text-[12px] text-[#374151] mt-0.5">{it.instruction}</p>

                  {/* What they actually said, because the instruction above was
                      written before they said it. */}
                  {it.repliedSinceBrief && it.lastInboundPreview && (
                    <div className="mt-1.5 flex items-start gap-1.5 text-[11px] text-[#7F1D1D] bg-[#FEF2F2] border border-[#FECACA] rounded-md px-2 py-1.5">
                      <Mail className="w-3 h-3 mt-0.5 flex-shrink-0" />
                      <span className="line-clamp-2">{it.lastInboundPreview}</span>
                    </div>
                  )}

                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    {it.flags.map((f) => (
                      <span
                        key={f}
                        className={cn(
                          'text-[9.5px] font-medium border rounded-full px-1.5 py-0.5',
                          FLAG_TONE[f] ?? 'bg-[#F3F4F6] text-[#4B5563] border-[#E5E7EB]',
                        )}
                      >
                        {f === 'overdue_followup' && <AlarmClock className="w-2.5 h-2.5 inline mr-0.5 -mt-0.5" />}
                        {FLAG_LABEL[f] ?? f}
                      </span>
                    ))}
                    <span className="text-[9.5px] text-[#9CA3AF] inline-flex items-center gap-0.5">
                      <Clock className="w-2.5 h-2.5" />
                      {hours(it.hoursSinceTouch)}
                    </span>
                  </div>
                </div>

                <ChevronRight className="w-4 h-4 text-[#D1D5DB] flex-shrink-0 mt-2" />
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
