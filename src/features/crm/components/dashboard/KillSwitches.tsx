import { Pause, Bot, ShieldOff } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { useKillSwitch } from '../../hooks/useKillSwitch';

export default function KillSwitches() {
  const ks = useKillSwitch();

  const switches = [
    {
      key: 'allDialers' as const,
      icon: Pause,
      label: 'Stop all dialers',
      activeLabel: 'Dialers paused',
      active: ks.allDialers,
    },
    {
      key: 'aiCoach' as const,
      icon: Bot,
      label: 'Disable AI coaching',
      activeLabel: 'AI coach off',
      active: ks.aiCoach,
    },
    {
      key: 'outbound' as const,
      icon: ShieldOff,
      label: 'Block outbound',
      activeLabel: 'Outbound blocked',
      active: ks.outbound,
    },
  ];

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-[#1A1A1A]">Kill switches</h3>
        <span className="text-[10px] text-[#9CA3AF] uppercase tracking-wide font-semibold">
          one-click safety
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {switches.map((s) => (
          <button
            key={s.key}
            onClick={() => ks.toggle(s.key)}
            className={cn(
              'flex items-center gap-2 px-3 py-3 rounded-xl border-2 transition-all text-left',
              s.active
                ? 'border-[#EF4444] bg-[#FEF2F2] text-[#B91C1C]'
                : 'border-[#E5E7EB] bg-white text-[#1A1A1A] hover:border-[#EF4444]/40 hover:bg-[#FEF2F2]/30'
            )}
          >
            <s.icon className="w-4 h-4 flex-shrink-0" strokeWidth={2} />
            <div className="flex-1">
              <div className="text-[13px] font-semibold">
                {s.active ? s.activeLabel : s.label}
              </div>
              <div className="text-[10px] text-[#9CA3AF]">
                {s.active ? 'Click to re-enable' : 'Click to halt'}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
