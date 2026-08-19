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
import { RefreshCw, Mail, Clock, AlarmClock, ChevronRight, ChevronDown, MoveUpRight } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { supabase } from '@/integrations/supabase/browser';
import { formatRelativeTime } from '../../data/helpers';
import {
  FLAG_LABEL, FLAG_TONE, attentionTone, hoursAgo, NOTHING_WAITING,
  BRAIN_OFF_NOTE, BRAIN_ON_NOTE,
} from '../../lib/dealDay';

interface MoveRow {
  id: string;
  contact_id: string;
  title: string | null;
  body: string | null;
  ts: string;
}

/** The movement log. Hugo, 19 Aug, pointing at the Today header: "the
 *  information I want there is the log of everything that has been moved,
 *  when I expand: what has been moved, and where, and why." The rows come
 *  from wk_activities kind 'stage_moved', which the stage-move trigger has
 *  stamped on every column change since 27 Jul: card, from, to, who (or
 *  "moved automatically"), when. Nothing here is computed; it is the record
 *  read back. */
function MovesLog() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<MoveRow[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open || loaded) return;
    void (async () => {
      const { data } = await supabase
        .from('wk_activities')
        .select('id, contact_id, title, body, ts')
        .eq('kind', 'stage_moved')
        .order('ts', { ascending: false })
        .limit(50);
      const moves = (data ?? []) as MoveRow[];
      setRows(moves);
      const ids = [...new Set(moves.map((m) => m.contact_id))];
      if (ids.length) {
        const { data: cs } = await supabase
          .from('wk_contacts').select('id, name').in('id', ids);
        setNames(new Map(((cs ?? []) as Array<{ id: string; name: string | null }>)
          .map((c) => [c.id, c.name ?? 'Unnamed'])));
      }
      setLoaded(true);
    })();
  }, [open, loaded]);

  return (
    <div className="border-t border-[#E5E7EB]" data-testid="moves-log">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 px-4 py-2.5 text-left hover:bg-[#F9FAFB]"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5 text-[#9CA3AF]" /> : <ChevronRight className="w-3.5 h-3.5 text-[#9CA3AF]" />}
        <MoveUpRight className="w-3.5 h-3.5 text-[#3C5A87]" />
        <span className="text-[12px] font-semibold text-[#1A1A1A]">What moved, where, and why</span>
        <span className="text-[10px] text-[#9CA3AF] ml-auto">last 50 moves</span>
      </button>
      {open && (
        <ul className="divide-y divide-[#F3F4F6] max-h-72 overflow-y-auto">
          {!loaded && (
            <li className="px-4 py-3 text-[11px] text-[#9CA3AF]">Reading the log...</li>
          )}
          {loaded && rows.length === 0 && (
            <li className="px-4 py-3 text-[11px] text-[#9CA3AF] italic">No moves recorded yet.</li>
          )}
          {rows.map((m) => (
            <li key={m.id} className="px-4 py-2">
              <div className="flex items-baseline gap-2">
                <span className="text-[11.5px] font-semibold text-[#1A1A1A] truncate">
                  {names.get(m.contact_id) ?? 'Unnamed'}
                </span>
                <span className="text-[10px] text-[#9CA3AF] flex-shrink-0 ml-auto">
                  {formatRelativeTime(m.ts)}
                </span>
              </div>
              <div className="text-[11px] text-[#374151]">{m.title}</div>
              {m.body && <div className="text-[10.5px] text-[#6B7280]">{m.body}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

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
      // Read text first: a Vercel timeout answers with a PLAIN-TEXT crash
      // page, and res.json() on it printed "Unexpected token 'A'" at Hugo
      // (19 Aug). A non-JSON body becomes a human sentence instead.
      const raw = await res.text();
      let json: { today?: TodayItem[]; managerEnabled?: boolean; error?: string };
      try {
        json = JSON.parse(raw) as typeof json;
      } catch {
        throw new Error(res.status === 504
          ? 'The server took too long building the day. Refresh to try again.'
          : `The server answered with an error (HTTP ${res.status}). Refresh to try again.`);
      }
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
            {/* Never claim the brain is off before the answer is in: this
                request is slow, and the default-false flag had the panel
                printing "the deal brain is off" for the whole load while the
                brain was on (seen live, 2026-08-17). */}
            {loading ? 'Reading the day...' : managerOn ? BRAIN_ON_NOTE : BRAIN_OFF_NOTE}
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
{NOTHING_WAITING}
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
                    attentionTone(it.attention),
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
                      {hoursAgo(it.hoursSinceTouch)}
                    </span>
                  </div>
                </div>

                <ChevronRight className="w-4 h-4 text-[#D1D5DB] flex-shrink-0 mt-2" />
              </div>
            </button>
          </li>
        ))}
      </ul>

      <MovesLog />
    </div>
  );
}
