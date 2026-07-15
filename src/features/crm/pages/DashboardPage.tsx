import { useState } from 'react';
import { Bot, Pause } from 'lucide-react';
import StatCards from '../components/dashboard/StatCards';
import LiveActivityFeed from '../components/dashboard/LiveActivityFeed';
import AgentsTable from '../components/dashboard/AgentsTable';
import KillSwitches from '../components/dashboard/KillSwitches';
import { useKillSwitch } from '../hooks/useKillSwitch';

export default function DashboardPage() {
  const ks = useKillSwitch();
  // PR 54 (Hugo 2026-04-27): clicking an agent row filters the
  // dashboard's Live Activity feed to that agent. Click again or hit
  // the "clear" chip on AgentsTable to reset.
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-5">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-[26px] font-bold text-[#1A1A1A] tracking-tight">
            Admin dashboard
          </h1>
          <p className="text-[13px] text-[#6B7280]">Mission control · realtime view of every agent + every line</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => ks.toggle('allDialers')}
            className="flex items-center gap-1.5 text-[12px] font-medium border border-[#E5E7EB] bg-white text-[#1A1A1A] px-3 py-2 rounded-[10px] hover:bg-[#FEF2F2] hover:border-[#EF4444]/40 hover:text-[#B91C1C]"
          >
            <Pause className="w-4 h-4" />
            {ks.allDialers ? 'Resume dialers' : 'Pause all dialers'}
          </button>
          <button
            onClick={() => ks.toggle('aiCoach')}
            className="flex items-center gap-1.5 text-[12px] font-medium border border-[#E5E7EB] bg-white text-[#1A1A1A] px-3 py-2 rounded-[10px] hover:bg-[#ECFDF5]"
          >
            <Bot className="w-4 h-4" />
            AI coach {ks.aiCoach ? 'OFF' : 'ON'}
          </button>
        </div>
      </header>

      <StatCards />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <LiveActivityFeed selectedAgentId={selectedAgentId} />
        <AgentsTable
          selectedAgentId={selectedAgentId}
          onSelectAgent={setSelectedAgentId}
        />
      </div>

      <KillSwitches />
    </div>
  );
}
