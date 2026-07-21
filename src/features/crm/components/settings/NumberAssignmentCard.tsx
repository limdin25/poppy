// NumberAssignmentCard — admin assigns numbers to agents (many-to-many) and
// labels each line. Lives in Settings → Numbers. A number can go to several
// agents and an agent can hold several; one number per agent can be marked
// primary (the default it sends from). Sends resolve the from-number from these
// assignments (see wk-sms-send).

import { useMemo, useState } from 'react';
import { Star, X, MessageSquare, Phone } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { useNumberAssignments } from '../../hooks/useNumberAssignments';

export default function NumberAssignmentCard() {
  const { numbers, agents, assignments, loading, error, assign, unassign, setPrimary, setLabel } = useNumberAssignments();

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-2xl p-5 mb-4">
      <div className="flex items-baseline justify-between mb-1">
        <h3 className="text-[14px] font-semibold text-[#1A1A1A]">Assign numbers to agents</h3>
        <span className="text-[11px] text-[#9CA3AF]">Many-to-many · label shows which is which</span>
      </div>
      <p className="text-[12px] text-[#6B7280] mb-4 leading-snug">
        Give each agent their line(s). A number can go to several agents, and an agent can hold
        several. The ★ marks an agent's default sending number. Agents text/call from their assigned
        number (matched to the contact's country).
      </p>

      {error && (
        <div className="text-[12px] text-[#B91C1C] bg-[#FEF2F2] border border-[#FCA5A5] rounded-lg px-3 py-2 mb-3">{error}</div>
      )}
      {loading ? (
        <div className="text-[12px] text-[#6B7280] py-4">Loading…</div>
      ) : numbers.length === 0 ? (
        <div className="text-[12px] text-[#6B7280] py-4">No numbers yet. Connect Twilio and Sync above.</div>
      ) : (
        <div className="space-y-3">
          {numbers.map((n) => (
            <NumberRow
              key={n.id}
              number={n}
              agents={agents}
              assignedIds={assignments.filter((a) => a.number_id === n.id)}
              onAssign={(agentId) => void assign(n.id, agentId)}
              onUnassign={(agentId) => void unassign(n.id, agentId)}
              onPrimary={(agentId, val) => void setPrimary(n.id, agentId, val)}
              onLabel={(label) => void setLabel(n.id, label)}
            />
          ))}
          {agents.length === 0 && (
            <p className="text-[11px] text-[#9CA3AF] pt-1">
              No agents yet — onboard agents (Agents &amp; spend) and they'll appear here to assign.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function NumberRow({
  number, agents, assignedIds, onAssign, onUnassign, onPrimary, onLabel,
}: {
  number: { id: string; e164: string; label: string | null; sms_enabled: boolean; voice_enabled: boolean };
  agents: Array<{ id: string; name: string }>;
  assignedIds: Array<{ agent_id: string; is_primary: boolean }>;
  onAssign: (agentId: string) => void;
  onUnassign: (agentId: string) => void;
  onPrimary: (agentId: string, val: boolean) => void;
  onLabel: (label: string) => void;
}) {
  const [label, setLabelLocal] = useState(number.label ?? '');
  const nameOf = useMemo(() => new Map(agents.map((a) => [a.id, a.name])), [agents]);
  const assignedSet = new Set(assignedIds.map((a) => a.agent_id));
  const unassigned = agents.filter((a) => !assignedSet.has(a.id));

  return (
    <div className="border border-[#E5E7EB] rounded-xl p-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-[13px] tabular-nums text-[#1A1A1A]">{number.e164}</span>
        <span className="flex items-center gap-1">
          {number.sms_enabled && <Badge icon={<MessageSquare className="w-3 h-3" />} text="SMS" />}
          {number.voice_enabled && <Badge icon={<Phone className="w-3 h-3" />} text="Voice" />}
        </span>
        <input
          value={label}
          onChange={(e) => setLabelLocal(e.target.value)}
          onBlur={() => { if (label !== (number.label ?? '')) onLabel(label); }}
          placeholder="Label (e.g. UK line — sales team)"
          className="ml-auto min-w-[200px] flex-1 px-2.5 py-1.5 text-[12px] border border-[#E5E7EB] rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-[#3C5A87]/30 focus:border-[#3C5A87]"
        />
      </div>

      <div className="flex items-center gap-1.5 flex-wrap mt-2.5">
        {assignedIds.length === 0 && <span className="text-[11px] text-[#9CA3AF]">Not assigned to anyone yet.</span>}
        {assignedIds.map((a) => (
          <span key={a.agent_id} className="inline-flex items-center gap-1 pl-1.5 pr-1 py-1 rounded-full bg-[#EEF2F8] border border-[#3C5A87]/20 text-[12px] text-[#1A1A1A]">
            <button
              onClick={() => onPrimary(a.agent_id, !a.is_primary)}
              title={a.is_primary ? "Primary sending number for this agent" : "Make this the agent's primary"}
              className="p-0.5 rounded hover:bg-white/60"
            >
              <Star className={cn('w-3.5 h-3.5', a.is_primary ? 'text-[#F59E0B] fill-[#F59E0B]' : 'text-[#9CA3AF]')} />
            </button>
            <span>{nameOf.get(a.agent_id) ?? 'Agent'}</span>
            <button onClick={() => onUnassign(a.agent_id)} title="Remove" className="p-0.5 rounded hover:bg-white/60 text-[#6B7280]">
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}

        {unassigned.length > 0 && (
          <select
            value=""
            onChange={(e) => { if (e.target.value) onAssign(e.target.value); }}
            className="inline-flex items-center text-[12px] border border-dashed border-[#CBD5E1] text-[#3C5A87] rounded-full px-2 py-1 bg-white hover:bg-[#F8FAFC] cursor-pointer"
          >
            <option value="">+ Assign agent</option>
            {unassigned.map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}
          </select>
        )}
      </div>
    </div>
  );
}

function Badge({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide text-[#3C5A87] bg-[#EEF2F8] px-1.5 py-0.5 rounded-full">
      {icon}{text}
    </span>
  );
}
