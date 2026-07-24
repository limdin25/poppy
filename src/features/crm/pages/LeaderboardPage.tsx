// LeaderboardPage — daily agent leaderboard.
//
// Hugo 2026-04-28 (PR 107): "I want to see who's pulling their weight
// today." Hugo 2026-04-28 (PR 109): messagesSent + show_on_leaderboard.
//
// Hugo 2026-07-24: source swapped from useReports (client-side aggregation
// over wk_calls, which RLS clips to the signed-in agent's OWN calls — so
// agents saw a board of one) to the wk_leaderboard RPC. Everyone now sees
// everyone, agents with no calls yet included, so the head-to-head is real.
//
// Sort: calls MADE desc — "who's calling more". Picked up stays a column.
// The signed-in agent's own row is highlighted so they see where they stand.

import { useMemo, useState } from 'react';
import { Trophy } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import {
  useLeaderboard,
  RANGE_LABELS,
  DEFAULT_LEADERBOARD_RANGE,
  type LeaderboardRange,
} from '../hooks/useLeaderboard';
import { useCurrentAgent } from '../hooks/useCurrentAgent';
import DailyReportsPanel from '../components/DailyReportsPanel';
import { formatDuration, formatPence } from '../data/helpers';

const RANGES: LeaderboardRange[] = ['today', 'yesterday', 'week', 'month'];

export default function LeaderboardPage() {
  // Opens on the rolling week — a today-only board reads empty every morning
  // before anyone has dialled (Hugo 2026-07-24).
  const [range, setRange] = useState<LeaderboardRange>(DEFAULT_LEADERBOARD_RANGE);
  const reports = useLeaderboard(range);
  const { agent: me } = useCurrentAgent();

  const rows = useMemo(
    () => [...reports.rows].sort((a, b) => b.calls - a.calls || b.answered - a.answered),
    [reports.rows]
  );

  return (
    <div className="p-6 max-w-[1200px] mx-auto space-y-5">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-[26px] font-bold text-[#1A1A1A] tracking-tight flex items-center gap-2">
            <Trophy className="w-6 h-6 text-[#3C5A87]" /> Leaderboard
          </h1>
          <p className="text-[13px] text-[#6B7280]">
            {RANGE_LABELS[range]} · ranked by calls made · updates every minute
          </p>
        </div>
        <div className="flex items-center gap-1 bg-white border border-[#E5E7EB] rounded-full p-1">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              data-testid={`leaderboard-range-${r}`}
              className={cn(
                'px-3 py-1.5 text-[12px] font-medium rounded-full transition-colors',
                range === r
                  ? 'bg-[#1A1A1A] text-white'
                  : 'text-[#6B7280] hover:bg-[#F3F3EE]',
              )}
            >
              {RANGE_LABELS[r]}
            </button>
          ))}
        </div>
      </header>

      <div className="bg-white border border-[#E5E7EB] rounded-2xl overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="bg-[#F3F3EE]/50 text-[10px] uppercase tracking-wide text-[#9CA3AF]">
            <tr>
              <th className="text-left px-3 py-2.5 font-semibold w-10">#</th>
              <th className="text-left px-3 py-2.5 font-semibold">Agent</th>
              <th className="text-right px-3 py-2.5 font-semibold">Calls made</th>
              <th className="text-right px-3 py-2.5 font-semibold">Picked up</th>
              <th className="text-right px-3 py-2.5 font-semibold">Messages</th>
              <th className="text-right px-3 py-2.5 font-semibold">VM drops</th>
              <th className="text-right px-3 py-2.5 font-semibold">Avg duration</th>
              <th className="text-right px-3 py-2.5 font-semibold">Spend</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E5E7EB]">
            {rows.map((r, i) => {
              const isMe = me?.id === r.agentId;
              const initials = (r.agentName || '?')
                .split(' ')
                .map((n) => n[0])
                .join('')
                .slice(0, 2)
                .toUpperCase();
              return (
                <tr
                  key={r.agentId}
                  className={cn(
                    'hover:bg-[#F3F3EE]/30 transition-colors',
                    isMe && 'bg-[#EEF2F8] hover:bg-[#EEF2F8]'
                  )}
                  data-testid={`leaderboard-row-${r.agentId}`}
                >
                  <td className="px-3 py-2.5 text-[#9CA3AF] tabular-nums font-semibold">
                    {i + 1}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <div
                        className={cn(
                          'w-7 h-7 rounded-full text-[11px] font-bold flex items-center justify-center flex-shrink-0',
                          isMe
                            ? 'bg-[#3C5A87] text-white'
                            : 'bg-[#3C5A87]/15 text-[#3C5A87]'
                        )}
                      >
                        {initials}
                      </div>
                      <div>
                        <div className="font-semibold text-[#1A1A1A]">
                          {r.agentName}
                          {isMe && (
                            <span className="ml-1.5 text-[10px] uppercase tracking-wide font-semibold text-[#3C5A87]">
                              you
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.calls}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-[#3C5A87]">
                    {r.answered}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {r.messagesSent}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {r.voicemailDrops || '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-[#6B7280]">
                    {r.avgDurationSec > 0 ? formatDuration(r.avgDurationSec) : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-[#6B7280]">
                    {formatPence(r.spendPence)}
                  </td>
                </tr>
              );
            })}
            {!reports.loading && rows.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-12 text-center text-[#9CA3AF] italic"
                >
                  {reports.error
                    ? `Could not load the board: ${reports.error}`
                    : `No agents to show for ${RANGE_LABELS[range].toLowerCase()} — tick who competes in Settings → Agents & spend.`}
                </td>
              </tr>
            )}
            {reports.loading && (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-12 text-center text-[#9CA3AF] italic"
                >
                  Loading…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Daily AI coaching reports — every agent reads every agent's, and the
          history stays so they can scroll back (Hugo 2026-07-24). */}
      <DailyReportsPanel />
    </div>
  );
}
