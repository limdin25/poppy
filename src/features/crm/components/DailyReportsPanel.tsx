// DailyReportsPanel — the daily AI coaching reports, on the leaderboard.
//
// Hugo 2026-07-24: written at 17:30 UK every day. Each agent reads ONLY their
// own — RLS on wk_agent_daily_reports enforces it, so there is no filtering
// here; an admin gets everyone's. The history stays so they can scroll back to
// any past day. The leaderboard TABLE above stays public — that's the
// competition; the coaching notes are not.
//
// Two sides on desktop: the day list on the left, that day's reports on the
// right. Stacks on mobile.

import { useMemo, useState } from 'react';
import { FileText, CalendarDays } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { useDailyReports } from '../hooks/useDailyReports';
import { useCurrentAgent } from '../hooks/useCurrentAgent';

function formatDay(key: string): string {
  const d = new Date(`${key}T12:00:00Z`);
  const today = new Date().toISOString().slice(0, 10);
  const yday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  if (key === today) return 'Today';
  if (key === yday) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Minimal markdown: **bold** and paragraph breaks. The report is written to
 *  a fixed shape by the cron prompt, so a full parser would be overkill. */
function Body({ md }: { md: string }) {
  const blocks = md.split(/\n{2,}/).filter((b) => b.trim());
  return (
    <div className="space-y-2.5">
      {blocks.map((block, i) => (
        <p key={i} className="text-[13px] leading-[1.6] text-[#1A1A1A] whitespace-pre-wrap">
          {block.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
            part.startsWith('**') && part.endsWith('**') ? (
              <strong key={j} className="font-semibold">{part.slice(2, -2)}</strong>
            ) : (
              <span key={j}>{part}</span>
            ),
          )}
        </p>
      ))}
    </div>
  );
}

export default function DailyReportsPanel() {
  const { reports, dates, loading, error } = useDailyReports();
  const { agent: me } = useCurrentAgent();
  const [picked, setPicked] = useState<string | null>(null);
  const day = picked ?? dates[0] ?? null;

  const shown = useMemo(
    () => reports.filter((r) => r.reportDate === day),
    [reports, day],
  );

  if (!loading && dates.length === 0) {
    return (
      <div className="bg-white border border-[#E5E7EB] rounded-2xl p-6 text-center">
        <FileText className="w-5 h-5 text-[#9CA3AF] mx-auto mb-2" />
        <p className="text-[13px] text-[#6B7280]">
          {error
            ? `Could not load reports: ${error}`
            : 'The first daily report lands at 5:30pm.'}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-[#E5E7EB] flex items-center gap-2">
        <FileText className="w-4 h-4 text-[#3C5A87]" />
        <span className="text-[13px] font-semibold text-[#1A1A1A]">Daily reports</span>
        <span className="text-[11px] text-[#9CA3AF]">· written at 5:30pm each day</span>
        <span className="ml-auto text-[10px] uppercase tracking-wide font-semibold text-[#9CA3AF]">
          private
        </span>
      </div>

      <div className="flex flex-col sm:flex-row">
        {/* Left: the day list — the history. */}
        <div className="sm:w-[190px] sm:border-r border-b sm:border-b-0 border-[#E5E7EB] max-h-[420px] overflow-y-auto flex-shrink-0">
          {dates.map((d) => (
            <button
              key={d}
              onClick={() => setPicked(d)}
              data-testid={`report-day-${d}`}
              className={cn(
                'w-full text-left px-4 py-2.5 text-[13px] flex items-center gap-2 border-b border-[#F3F3EE] transition-colors',
                d === day
                  ? 'bg-[#EEF2F8] text-[#1A1A1A] font-semibold'
                  : 'text-[#6B7280] hover:bg-[#F3F3EE]/60',
              )}
            >
              <CalendarDays className="w-3.5 h-3.5 flex-shrink-0 opacity-60" />
              {formatDay(d)}
            </button>
          ))}
        </div>

        {/* Right: every agent's report for the chosen day. */}
        <div className="flex-1 p-4 space-y-4 max-h-[420px] overflow-y-auto">
          {loading && <p className="text-[13px] text-[#9CA3AF] italic">Loading…</p>}
          {shown.map((r) => {
            const isMe = me?.id === r.agentId;
            return (
              <div
                key={r.id}
                data-testid={`report-${r.agentId}`}
                className={cn(
                  'rounded-xl p-4 border',
                  isMe ? 'bg-[#EEF2F8] border-[#3C5A87]/25' : 'bg-[#F3F3EE]/50 border-[#E5E7EB]',
                )}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[13px] font-bold text-[#1A1A1A]">{r.agentName}</span>
                  {isMe && (
                    <span className="text-[10px] uppercase tracking-wide font-semibold text-[#3C5A87]">
                      you
                    </span>
                  )}
                  <span className="ml-auto text-[11px] text-[#9CA3AF] tabular-nums">
                    {r.stats.dials ?? 0} dials · {r.stats.conversations ?? 0} convos ·{' '}
                    {(r.stats.interested ?? 0) + (r.stats.booked ?? 0)} interested
                  </span>
                </div>
                <Body md={r.bodyMd} />
              </div>
            );
          })}
          {!loading && shown.length === 0 && (
            <p className="text-[13px] text-[#9CA3AF] italic">No report for this day.</p>
          )}
        </div>
      </div>
    </div>
  );
}
