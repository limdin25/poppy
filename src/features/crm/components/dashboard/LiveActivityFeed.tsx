import { useEffect, useState } from 'react';
import { Eye, Bot, Phone } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { useLiveActivity } from '../../hooks/useLiveActivity';
import WatchAgentModal from './WatchAgentModal';

const STATUS_DOT = {
  queued: 'bg-[#9CA3AF]',
  ringing: 'bg-[#F59E0B] animate-pulse',
  in_progress: 'bg-[#3C5A87] animate-pulse',
} as const;

function formatLiveDuration(startedAtIso: string, nowMs: number): string {
  const startMs = +new Date(startedAtIso);
  const dur = Math.max(0, Math.floor((nowMs - startMs) / 1000));
  const m = Math.floor(dur / 60);
  const s = dur % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

interface Props {
  /** PR 54 (Hugo 2026-04-27): when set, only show this agent's
   *  active calls. Wired from DashboardPage via AgentsTable click. */
  selectedAgentId?: string | null;
}

export default function LiveActivityFeed({ selectedAgentId }: Props = {}) {
  const { rows, loading } = useLiveActivity(selectedAgentId ?? null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [watching, setWatching] = useState<{ callId: string; agentName: string; contactName: string } | null>(null);

  // 1Hz tick for the live duration
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-[#E5E7EB] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#3C5A87] animate-pulse" />
          <h3 className="text-[13px] font-semibold text-[#1A1A1A]">Live activity</h3>
          <span className="text-[10px] text-[#9CA3AF]">realtime</span>
        </div>
        <span className="text-[11px] text-[#6B7280]">{rows.length} active</span>
      </div>

      <div className="divide-y divide-[#E5E7EB]">
        {rows.map((row) => (
          <div
            key={row.callId}
            className="px-4 py-2.5 flex items-center gap-3 text-[13px] hover:bg-[#F3F3EE]/50"
          >
            <span
              className={cn(
                'w-2.5 h-2.5 rounded-full flex-shrink-0',
                STATUS_DOT[row.status]
              )}
            />
            <span className="font-semibold text-[#1A1A1A] w-20 truncate">
              {row.agentName.split(' ')[0]}
            </span>
            <span className="text-[#6B7280] truncate flex-1">
              {row.status === 'queued' ? 'queued ' : 'calling '}
              <span className="text-[#1A1A1A]">{row.contactName}</span>
            </span>
            <span className="text-[#6B7280] tabular-nums">
              {formatLiveDuration(row.startedAt, nowMs)}
            </span>
            {row.aiCoachEnabled && (
              <span className="flex items-center gap-1 text-[10px] font-medium bg-[#EEF2F8] text-[#3C5A87] px-1.5 py-0.5 rounded">
                <Bot className="w-3 h-3" /> coach
              </span>
            )}
            <button
              onClick={() =>
                setWatching({
                  callId: row.callId,
                  agentName: row.agentName,
                  contactName: row.contactName,
                })
              }
              className="flex items-center gap-1 text-[11px] text-[#6B7280] hover:text-[#3C5A87] px-2 py-1 rounded hover:bg-[#EEF2F8]"
              title="Watch this call (read-only)"
            >
              <Eye className="w-3.5 h-3.5" /> watch
            </button>
            <button
              className="text-[11px] text-[#6B7280] hover:text-[#3C5A87] px-2 py-1 rounded hover:bg-[#EEF2F8]"
              title={row.contactPhone}
            >
              <Phone className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        {!loading && rows.length === 0 && (
          <div className="px-4 py-8 text-center text-[12px] text-[#9CA3AF] italic">
            No active calls right now.
          </div>
        )}
        {loading && (
          <div className="px-4 py-6 text-center text-[12px] text-[#9CA3AF]">Loading…</div>
        )}
      </div>
      {watching && (
        <WatchAgentModal
          callId={watching.callId}
          agentName={watching.agentName}
          contactName={watching.contactName}
          onClose={() => setWatching(null)}
        />
      )}
    </div>
  );
}
