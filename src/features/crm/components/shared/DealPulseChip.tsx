// The pulse, on the card. "They replied, 3h ago" in amber when the ball is
// ours, or "Email sent, 2h ago" for whatever the cockpit last did. One line,
// because the card is 280px wide and already carries ten other things.
//
// A reply is a click through to the inbox: the next thing a human does with
// "they replied" is read it.

import { Check, CornerDownLeft } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { formatRelativeTime } from '../../data/helpers';
import type { DealPulse } from '../../lib/dealPulse';

export default function DealPulseChip({ pulse, onOpenInbox, className }: {
  pulse: DealPulse | null | undefined;
  onOpenInbox?: () => void;
  className?: string;
}) {
  if (!pulse) return null;
  const replied = pulse.kind === 'replied';
  const clickable = replied && !!onOpenInbox;

  return (
    <span
      data-testid="deal-pulse"
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? (e) => { e.stopPropagation(); onOpenInbox(); } : undefined}
      onKeyDown={clickable ? (e) => {
        if (e.key === 'Enter') { e.stopPropagation(); onOpenInbox(); }
      } : undefined}
      title={pulse.preview ?? undefined}
      className={cn(
        'inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded',
        replied
          ? 'bg-[#FDF3E3] text-[#9A6B1E] cursor-pointer hover:bg-[#F9E8C8]'
          : 'bg-[#E8F5EC] text-[#2E7D43]',
        className,
      )}
    >
      {replied
        ? <CornerDownLeft className="w-2.5 h-2.5" />
        : <Check className="w-2.5 h-2.5" />}
      {pulse.label} · {formatRelativeTime(pulse.at)}
    </span>
  );
}
