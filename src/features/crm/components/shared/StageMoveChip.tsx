// StageMoveChip — "where this lead last moved, when, and who moved it".
//
// Hugo 2026-07-27: "the static pipeline always show last movement even manual
// and by who." Fed entirely by the denormalised columns migration
// 20260727000006 stamps on wk_contacts, so a 1,100-card board renders this with
// ZERO extra queries.
//
// Column names resolve from the store, the mover's name from the agent
// directory — the caller passes the contact and nothing else.

import { MoveUpRight } from 'lucide-react';
import { useSmsV2 } from '../../store/SmsV2Store';
import { useAgentDirectory } from '../../hooks/useAgentDirectory';
import { formatDateTime, formatRelativeTime } from '../../data/helpers';
import {
  stageMoveLabel,
  stageMoveTitle,
  isAutomaticMove,
  type StageMove,
  type StageMoveSource,
} from '../../lib/stageHistory';
import type { Contact } from '../../types';

export interface StageMoveChipProps {
  contact: Pick<
    Contact,
    'stageMovedAt' | 'stageMovedBy' | 'stageMovedFrom' | 'stageMoveSource' | 'pipelineColumnId'
  >;
  size?: 'xs' | 'sm';
  className?: string;
}

const SIZE = { xs: 'text-[10px]', sm: 'text-[11px]' } as const;

export default function StageMoveChip({ contact, size = 'xs', className = '' }: StageMoveChipProps) {
  const { columns } = useSmsV2();
  const { byId, loading } = useAgentDirectory();

  const nameOfColumn = (id?: string) => columns.find((c) => c.id === id)?.name ?? null;
  const source = (contact.stageMoveSource ?? null) as StageMoveSource;

  const move: StageMove = {
    at: contact.stageMovedAt ?? null,
    byName: contact.stageMovedBy ? (byId.get(contact.stageMovedBy)?.name ?? null) : null,
    fromName: nameOfColumn(contact.stageMovedFrom),
    toName: nameOfColumn(contact.pipelineColumnId),
    source,
  };

  // Don't render a half-truth while the roster is still in flight on an
  // agent-attributed move — the relative time alone is fine for one tick.
  const pendingName = source === 'agent' && loading && !move.byName;

  const label = stageMoveLabel(move, move.at ? formatRelativeTime(move.at) : '');
  const title = stageMoveTitle(move, move.at ? formatDateTime(move.at) : '');

  const tone = !move.at
    ? 'text-[#D1D5DB]'
    : isAutomaticMove(source) || source === 'backfill'
      ? 'text-[#6B7280]'
      : 'text-[#3C5A87]';

  return (
    <span
      className={`inline-flex items-center gap-1 min-w-0 ${SIZE[size]} ${tone} ${className}`}
      title={title}
      data-testid="stage-move-chip"
    >
      <MoveUpRight className="w-2.5 h-2.5 flex-shrink-0" />
      <span className="truncate min-w-0">{pendingName ? label.replace(/ · $/, '') : label}</span>
    </span>
  );
}
