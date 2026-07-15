import { useState } from 'react';
import { Settings as SettingsIcon, Circle, X } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { MOCK_AGENTS } from '../../data/mockAgents';
import { formatPence, formatDuration, statusColour } from '../../data/helpers';
import { useAgentsToday } from '../../hooks/useAgentsToday';

const STATUS_LABEL: Record<string, string> = {
  busy: '🟢 busy',
  available: '🟢 free',
  idle: '🟡 idle',
  offline: '🔴 off',
};

interface Props {
  /** PR 54 (Hugo 2026-04-27): selected agent id (set by clicking a
   *  row) — when present the parent dashboard filters its live feed
   *  + KPIs to that agent. Pass undefined for the unfiltered "all
   *  agents" view. */
  selectedAgentId?: string | null;
  onSelectAgent?: (agentId: string | null) => void;
}

export default function AgentsTable({ selectedAgentId, onSelectAgent }: Props = {}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const { agents: realAgents } = useAgentsToday();
  const agents = realAgents.length > 0 ? realAgents : MOCK_AGENTS;

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-[#E5E7EB] flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-[#1A1A1A]">
          Agents today
          {selectedAgentId && (
            <span className="ml-2 text-[10px] font-medium text-[#1E9A80] bg-[#ECFDF5] px-1.5 py-0.5 rounded">
              filtered
            </span>
          )}
        </h3>
        {selectedAgentId && onSelectAgent && (
          <button
            onClick={() => onSelectAgent(null)}
            className="flex items-center gap-1 text-[11px] text-[#6B7280] hover:text-[#1A1A1A]"
            title="Clear filter"
          >
            <X className="w-3 h-3" /> clear
          </button>
        )}
      </div>
      <table className="w-full text-[12px]">
        <thead className="bg-[#F3F3EE]/50 text-[10px] uppercase tracking-wide text-[#9CA3AF]">
          <tr>
            <th className="text-left px-4 py-2 font-semibold">Agent</th>
            <th className="text-left px-2 py-2 font-semibold">Status</th>
            <th className="text-right px-2 py-2 font-semibold">Calls</th>
            <th className="text-right px-2 py-2 font-semibold">Ans %</th>
            <th className="text-right px-2 py-2 font-semibold">SMS</th>
            <th className="text-right px-2 py-2 font-semibold">Avg dur</th>
            <th className="text-right px-2 py-2 font-semibold">Spend</th>
            <th className="text-right px-2 py-2 font-semibold">Limit</th>
            <th className="px-2 py-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#E5E7EB]">
          {agents.filter((a) => !a.isAdmin).map((a) => {
            const isSelected = selectedAgentId === a.id;
            const onRowClick = () => {
              if (!onSelectAgent) return;
              onSelectAgent(isSelected ? null : a.id);
            };
            return (
              <tr
                key={a.id}
                onClick={onRowClick}
                className={cn(
                  'hover:bg-[#F3F3EE]/30 cursor-pointer transition-colors',
                  isSelected && 'bg-[#ECFDF5] hover:bg-[#ECFDF5]'
                )}
                title={onSelectAgent ? (isSelected ? 'Click to clear filter' : 'Click to filter dashboard to this agent') : undefined}
              >
                <td className="px-4 py-2.5 font-semibold text-[#1A1A1A]">{a.name}</td>
                <td className="px-2 py-2.5">
                  <span className="inline-flex items-center gap-1.5 text-[12px]">
                    <Circle
                      className="w-2 h-2"
                      fill={statusColour(a.status)}
                      stroke={statusColour(a.status)}
                    />
                    {STATUS_LABEL[a.status] ?? a.status}
                  </span>
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums">{a.callsToday}</td>
                <td className="px-2 py-2.5 text-right tabular-nums">
                  {a.callsToday > 0 ? `${a.answerRatePct ?? 0}%` : '—'}
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums">{a.smsSentToday ?? 0}</td>
                <td className="px-2 py-2.5 text-right tabular-nums">
                  {a.avgDurationSec ? formatDuration(a.avgDurationSec) : '—'}
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums">
                  {formatPence(a.spendPence)}
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums">
                  {editingId === a.id ? (
                    <input
                      autoFocus
                      defaultValue={(a.limitPence / 100).toFixed(0)}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={() => setEditingId(null)}
                      onKeyDown={(e) => e.key === 'Enter' && setEditingId(null)}
                      className="w-16 px-1.5 py-0.5 border border-[#1E9A80] rounded text-right tabular-nums"
                    />
                  ) : (
                    <span>{formatPence(a.limitPence)}</span>
                  )}
                </td>
                <td className="px-2 py-2.5 text-right">
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditingId(editingId === a.id ? null : a.id); }}
                    className="p-1 rounded hover:bg-[#ECFDF5] text-[#6B7280] hover:text-[#1E9A80]"
                    title="Edit limit (instant)"
                  >
                    <SettingsIcon className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
