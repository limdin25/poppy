// AgentChip — the one way "whose lead is this" gets rendered.
//
// Hugo 2026-07-27: "leads must always have the name of who it belongs to, on
// the card always, in all pages — even history, report, pipeline, inbox."
//
// Four states, and the difference between them matters:
//   named      — resolved through useAgentDirectory
//   unassigned — nobody owns it. Red italic, like ContactIdentity's gap markers,
//                because it is a gap an operator can and should fix.
//   loading    — the roster hasn't landed. A muted '…', NEVER "Unassigned":
//                flashing "Unassigned" at a lead that HAS an owner is exactly
//                the lie ContactDetailPage told for months.
//   unknown    — an id the roster can't resolve (deleted profile). Grey, not
//                red — nobody can fix it by typing.

import { useAgentDirectory, resolveAgentLabel, agentInitials } from '../../hooks/useAgentDirectory';

export interface AgentChipProps {
  agentId?: string | null;
  size?: 'xs' | 'sm';
  /** 'chip' = initials disc + name. 'text' = bare name, for table cells. */
  variant?: 'chip' | 'text';
  /** Optional prefix, e.g. 'Owner'. */
  label?: string;
  className?: string;
}

const SIZE = { xs: 'text-[10px]', sm: 'text-[11px]' } as const;
const DISC = { xs: 'w-3.5 h-3.5 text-[7px]', sm: 'w-4 h-4 text-[8px]' } as const;

const TONE = {
  named: 'text-[#374151]',
  unassigned: 'text-[#C4302B] italic',
  loading: 'text-[#D1D5DB]',
  unknown: 'text-[#9CA3AF] italic',
} as const;

export default function AgentChip({
  agentId,
  size = 'xs',
  variant = 'chip',
  label,
  className = '',
}: AgentChipProps) {
  const { byId, loading } = useAgentDirectory();
  const { label: name, state } = resolveAgentLabel(agentId, byId, loading);
  const title = label ? `${label}: ${name}` : name;

  if (variant === 'text') {
    return (
      <span
        className={`${SIZE[size]} truncate ${TONE[state]} ${className}`}
        title={title}
        data-testid="agent-chip"
      >
        {name}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 min-w-0 ${className}`}
      title={title}
      data-testid="agent-chip"
    >
      {state === 'named' && (
        <span
          className={`${DISC[size]} rounded-full bg-[#3C5A87]/15 text-[#3C5A87] font-bold flex items-center justify-center flex-shrink-0`}
        >
          {agentInitials(name)}
        </span>
      )}
      {label && (
        <span className={`${SIZE[size]} text-[#9CA3AF] flex-shrink-0`}>{label}</span>
      )}
      <span className={`${SIZE[size]} truncate min-w-0 ${TONE[state]}`}>{name}</span>
    </span>
  );
}
