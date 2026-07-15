import type { LucideIcon } from 'lucide-react';
import { Phone, Users, PoundSterling, Activity, Radio } from 'lucide-react';
import { useDashboardStats } from '../../hooks/useDashboardStats';
import { formatPence } from '../../data/helpers';

interface Stat {
  label: string;
  value: string;
  icon: LucideIcon;
  hint?: string;
  tone?: 'default' | 'green';
}

export default function StatCards() {
  const s = useDashboardStats();
  const STATS: Stat[] = [
    {
      label: 'Calls today',
      value: s.loading ? '—' : String(s.callsToday),
      icon: Phone,
      hint: 'live count',
      tone: 'green',
    },
    {
      label: 'Active agents',
      value: s.loading ? '—' : `${s.activeAgents} / ${s.totalAgents}`,
      icon: Users,
      hint: s.totalAgents - s.activeAgents > 0 ? `${s.totalAgents - s.activeAgents} offline` : 'all online',
    },
    {
      label: 'Spend today',
      value: s.loading ? '—' : formatPence(s.spendTodayPence),
      icon: PoundSterling,
      hint: 'across all agents',
    },
    {
      label: 'Answer rate',
      value: s.loading ? '—' : `${s.answerRatePercent}%`,
      icon: Activity,
      hint: 'rolling 24h',
    },
    {
      label: 'Connected now',
      value: s.loading ? '—' : String(s.connectedNow),
      icon: Radio,
      hint: 'live calls',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {STATS.map((s) => (
        <div
          key={s.label}
          className="bg-white border border-[#E5E7EB] rounded-2xl p-4 hover:shadow-[0_4px_24px_-2px_rgba(0,0,0,0.08)] transition-all"
        >
          <div className="flex items-start justify-between">
            <div className="text-[11px] uppercase tracking-wide text-[#9CA3AF] font-semibold">
              {s.label}
            </div>
            <s.icon
              className="w-4 h-4 text-[#1E9A80]"
              strokeWidth={1.8}
            />
          </div>
          <div
            className={
              'text-[26px] font-bold mt-2 tabular-nums ' +
              (s.tone === 'green' ? 'text-[#1E9A80]' : 'text-[#1A1A1A]')
            }
          >
            {s.value}
          </div>
          {s.hint && <div className="text-[11px] text-[#6B7280] mt-0.5">{s.hint}</div>}
        </div>
      ))}
    </div>
  );
}
