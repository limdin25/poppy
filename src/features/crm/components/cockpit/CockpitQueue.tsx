// The prioritised list: the most urgent deal in the business, at the top.
//
// Hugo, 2026-08-15: "a prioritised deal list with the most urgent actions at
// the top."
//
// THE ORDER IS THE PROMISE. The server sorts it, and this re-sorts by the same
// rule, so a payload that arrives out of order can never bury a 95 under a 20.
// That is the one thing that must hold whether the deal brain is on or off,
// and it is what the e2e test asserts by reading data-attention off each row.

import { Mail, Clock, AlarmClock, ChevronRight } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { attentionTone, hoursAgo, sortFlags, FLAG_LABEL, FLAG_TONE, URGENT_AT } from '../../lib/dealDay';
import type { CockpitDeal } from './types';

export function AttentionChip({ score, big }: { score: number; big?: boolean }) {
  return (
    <div
      className={cn(
        'flex-shrink-0 rounded-full grid place-items-center font-bold tabular-nums',
        big ? 'w-12 h-12 text-[16px]' : 'w-9 h-9 text-[12px]',
        attentionTone(score),
      )}
      title={`Attention ${score} of 100`}
    >
      {score}
    </div>
  );
}

/** How sure the brain is. Hugo, 16 Aug: "how confident are you on that?" */
export function ConfidenceChip({ confidence }: { confidence: 'high' | 'medium' | 'low' | null }) {
  if (!confidence) return null;
  const tone = confidence === 'high'
    ? 'bg-[#ECFDF5] text-[#047857] border-[#A7F3D0]'
    : confidence === 'medium'
      ? 'bg-[#FFFBEB] text-[#B45309] border-[#FDE68A]'
      : 'bg-[#FEF2F2] text-[#B91C1C] border-[#FECACA]';
  return (
    <span className={`text-[9.5px] font-medium border rounded-full px-1.5 py-0.5 ${tone}`} data-testid="cockpit-confidence">
      {confidence} confidence
    </span>
  );
}

export function FlagPills({ flags, className }: { flags: string[]; className?: string }) {
  if (!flags.length) return null;
  return (
    <>
      {sortFlags(flags).map((f) => (
        <span
          key={f}
          className={cn(
            'text-[9.5px] font-medium border rounded-full px-1.5 py-0.5',
            FLAG_TONE[f] ?? 'bg-[#F3F4F6] text-[#4B5563] border-[#E5E7EB]',
            className,
          )}
        >
          {f === 'overdue_followup' && <AlarmClock className="w-2.5 h-2.5 inline mr-0.5 -mt-0.5" />}
          {FLAG_LABEL[f] ?? f}
        </span>
      ))}
    </>
  );
}

/** What the branch actually said.
 *
 *  In the row it is clamped; in the command panel it is not, and it sits ABOVE
 *  the brief, because the brief was written before they wrote and that
 *  inversion is the whole reason the flag exists. */
export function ReplyBlock({ preview, at, full }: {
  preview: string | null; at?: string | null; full?: boolean;
}) {
  if (!preview) return null;
  return (
    <div className="mt-1.5 flex items-start gap-1.5 text-[11px] text-[#7F1D1D] bg-[#FEF2F2] border border-[#FECACA] rounded-md px-2 py-1.5">
      <Mail className="w-3 h-3 mt-0.5 flex-shrink-0" />
      <div className="min-w-0">
        <span className={cn('block', !full && 'line-clamp-2')}>{preview}</span>
        {full && at && (
          <span className="mt-0.5 block text-[10px] text-[#B91C1C]">
            They wrote at {new Date(at).toLocaleString('en-GB', { timeZone: 'Europe/London' })}
          </span>
        )}
      </div>
    </div>
  );
}

function QueueRow({ deal, selected, onSelect }: {
  deal: CockpitDeal; selected: boolean; onSelect: () => void;
}) {
  const urgent = deal.attention >= URGENT_AT;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        data-testid="cockpit-row"
        data-attention={deal.attention}
        className={cn(
          'w-full text-left px-3 py-3 transition-colors border-l-[3px]',
          // Urgency is the rail colour, selection is the fill, so the two
          // never fight over the same edge.
          urgent ? 'border-l-[#DC2626]' : 'border-l-transparent',
          selected ? 'bg-brand-50' : 'hover:bg-[#F9FAFB]',
        )}
      >
        <div className="flex items-start gap-3">
          <AttentionChip score={deal.attention} />

          <div className="min-w-0 flex-1">
            {/* THE CARD IS THE BRANCH. The conversation is with the office,
                and the pipeline card Hugo counts is the office, so the row
                leads with its name; the houses sit underneath. */}
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[13px] font-semibold text-ink truncate">
                {deal.contactName ?? deal.address ?? 'Unnamed property'}
              </span>
              {deal.column && (
                <span className="text-[10px] text-ink-muted flex-shrink-0 truncate">
                  {deal.column}
                </span>
              )}
            </div>
            {deal.contactName && deal.address && (
              <p className="text-[11px] text-ink-muted truncate">
                {deal.address}
                {(deal.others?.length ?? 0) > 0 && (
                  <span className="text-ink-subtle">
                    {' '}and {deal.others!.length} more {deal.others!.length === 1 ? 'house' : 'houses'}
                  </span>
                )}
              </p>
            )}

            {/* The row must not preview an order this reader is not allowed to
                see. Without this it showed the stale brief underneath, which is
                how "Hold, nothing today" reached the queue as well as the panel. */}
            {deal.blockedOnHugo ? (
              <p className="text-[12px] text-[#9A3412] mt-0.5 font-medium">
                Hugo is on this one. Nothing for you today.
              </p>
            ) : (
              <p className="text-[12px] text-[#374151] mt-0.5 line-clamp-2">{deal.instruction}</p>
            )}

            {deal.repliedSinceBrief && (
              <ReplyBlock preview={deal.lastInboundPreview} />
            )}

            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              {!deal.blockedOnHugo && <ConfidenceChip confidence={deal.confidence} />}
              <FlagPills flags={deal.flags} />
              <span className="text-[9.5px] text-ink-subtle inline-flex items-center gap-0.5">
                <Clock className="w-2.5 h-2.5" />
                {hoursAgo(deal.hoursSinceTouch)}
              </span>
              {deal.stale && !deal.blockedOnHugo && (
                <span
                  className="text-[9.5px] text-ink-subtle"
                  title="Something has happened since this instruction was written. The sweep catches up within two minutes."
                >
                  written before the last change
                </span>
              )}
            </div>
          </div>

          <ChevronRight className="w-4 h-4 text-[#D1D5DB] flex-shrink-0 mt-2" />
        </div>
      </button>
    </li>
  );
}

export default function CockpitQueue({ deals, selectedId, onSelect }: {
  deals: CockpitDeal[];
  selectedId: string | null;
  onSelect: (propertyId: string) => void;
}) {
  const ordered = [...deals].sort((a, b) =>
    b.attention - a.attention
    || (b.hoursSinceTouch ?? 0) - (a.hoursSinceTouch ?? 0)
    || String(a.address).localeCompare(String(b.address)));

  const anyUrgent = ordered.some((d) => d.attention >= URGENT_AT);

  return (
    <>
      <div className="px-3 pt-2 pb-1">
        {anyUrgent ? (
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#DC2626]">
            Start here
          </span>
        ) : (
          <span className="text-[10px] font-bold uppercase tracking-wider text-ink-subtle">
            Nothing urgent. Work top down.
          </span>
        )}
      </div>
      <ul className="divide-y divide-border" data-testid="cockpit-queue-list">
        {ordered.map((d) => (
          <QueueRow
            key={d.propertyId}
            deal={d}
            // A switched-to sub-house still lights up its branch card.
            selected={d.propertyId === selectedId
              || (d.others ?? []).some((o) => o.propertyId === selectedId)}
            onSelect={() => onSelect(d.propertyId)}
          />
        ))}
      </ul>
    </>
  );
}
