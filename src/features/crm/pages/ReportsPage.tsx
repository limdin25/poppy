import { useState } from 'react';
import { Trophy } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { formatDuration, formatPence } from '../data/helpers';
import { useReports, type ReportRange } from '../hooks/useReports';

const RANGES: Array<{ key: ReportRange; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
];

export default function ReportsPage() {
  const [range, setRange] = useState<ReportRange>('today');
  const r = useReports(range);
  const maxBucket = Math.max(1, ...r.hourly);

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-5">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-[26px] font-bold text-[#1A1A1A] tracking-tight">Reports</h1>
          <p className="text-[13px] text-[#6B7280]">
            Calls per {range === 'today' ? 'hour' : 'day'} · leaderboard · spend
          </p>
        </div>
        <div className="flex gap-1 bg-[#F3F3EE] p-1 rounded-[10px] border border-[#E5E7EB]">
          {RANGES.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setRange(opt.key)}
              className={cn(
                'px-3 py-1 text-[12px] font-medium rounded-[8px]',
                range === opt.key ? 'bg-white text-[#3C5A87] shadow-sm' : 'text-[#6B7280]'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label="Calls" value={r.loading ? '—' : String(r.totalCalls)} />
        <KPI
          label="Answer rate"
          value={r.loading ? '—' : `${r.answerRatePercent}%`}
        />
        <KPI
          label="Avg duration"
          value={r.loading || r.avgDurationSec === 0 ? '—' : formatDuration(r.avgDurationSec)}
        />
        <KPI label="Total spend" value={r.loading ? '—' : formatPence(r.totalSpendPence)} />
      </div>

      {/* Calls per hour / per day chart */}
      <div className="bg-white border border-[#E5E7EB] rounded-2xl p-5">
        <h3 className="text-[13px] font-semibold text-[#1A1A1A] mb-3">
          Calls per {range === 'today' ? 'hour' : 'day'}
        </h3>
        {r.loading ? (
          <div className="h-32 flex items-center justify-center text-[12px] text-[#9CA3AF]">
            Loading…
          </div>
        ) : r.hourly.every((h) => h === 0) ? (
          <div className="h-32 flex items-center justify-center text-[12px] text-[#9CA3AF] italic">
            No calls in this range yet.
          </div>
        ) : (
          <div className="flex items-end gap-1.5 h-32">
            {r.hourly.map((h, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="w-full bg-[#3C5A87] rounded-t transition-all hover:opacity-80"
                  style={{ height: `${(h / maxBucket) * 100}%` }}
                  title={`${h} calls`}
                />
                <div className="text-[9px] text-[#9CA3AF] tabular-nums">
                  {r.hourLabels[i]}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Leaderboard */}
      <div className="bg-white border border-[#E5E7EB] rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#E5E7EB]">
          <h3 className="text-[13px] font-semibold text-[#1A1A1A]">Agent leaderboard</h3>
        </div>
        <table className="w-full text-[13px]">
          <thead className="bg-[#F3F3EE]/50 text-[10px] uppercase tracking-wide text-[#9CA3AF]">
            <tr>
              <th className="text-left px-4 py-2 font-semibold w-10">#</th>
              <th className="text-left px-2 py-2 font-semibold">Agent</th>
              <th className="text-right px-2 py-2 font-semibold">Calls</th>
              <th className="text-right px-2 py-2 font-semibold">Answer %</th>
              <th className="text-right px-2 py-2 font-semibold">Avg dur</th>
              <th className="text-right px-2 py-2 font-semibold">Spend</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E5E7EB]">
            {r.leaderboard.map((a, i) => (
              <tr key={a.agentId} className="hover:bg-[#F3F3EE]/30">
                <td className="px-4 py-2.5 text-[#9CA3AF] font-bold tabular-nums">{i + 1}</td>
                <td className="px-2 py-2.5 font-semibold text-[#1A1A1A]">{a.agentName}</td>
                <td className="px-2 py-2.5 text-right tabular-nums">{a.calls}</td>
                <td className="px-2 py-2.5 text-right tabular-nums">
                  {a.calls ? Math.round((a.answered / a.calls) * 100) + '%' : '—'}
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums">
                  {a.avgDurationSec ? formatDuration(a.avgDurationSec) : '—'}
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums">
                  {formatPence(a.spendPence)}
                </td>
                <td className="px-2 py-2.5">
                  {i === 0 && <Trophy className="w-4 h-4 text-[#F59E0B]" />}
                </td>
              </tr>
            ))}
            {!r.loading && r.leaderboard.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-[12px] text-[#9CA3AF] italic">
                  No agent calls in this range yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KPI({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-[#E5E7EB] rounded-2xl p-4">
      <div className="text-[11px] uppercase tracking-wide text-[#9CA3AF] font-semibold">
        {label}
      </div>
      <div className="text-[28px] font-bold text-[#1A1A1A] tabular-nums mt-1">{value}</div>
    </div>
  );
}
