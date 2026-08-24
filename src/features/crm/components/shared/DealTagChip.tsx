// DealTagChip — "which house is this conversation about", on the card itself.
//
// Hugo, 2026-08-24: "all card you need to tag which deal is whatsapp
// conversation for, make very clean on chat card and everywhere."
//
// The label is NOT worked out here. It comes from dealTagFor() in
// ../../lib/dealTag, so the chat card, the thread header, the contact list and
// anything added later all print the same words for the same thread. This file
// is only how it looks.
//
// A builder and the branch are drawn differently on purpose. They are two
// separate conversations about one house, they sit next to each other in the
// list, and confirming a viewing with the wrong one is a real mistake that
// costs a builder trip. So the builder chip says "builder" in as many words.
//
// Renders nothing when there is no deal, which is every plumber lead in the
// reviews inbox.

import { Home, Hammer } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { dealTagFor, type DealTagSource } from '../../lib/dealTag';

export interface DealTagChipProps extends DealTagSource {
  /** 'xs' sits in a dense list row, 'sm' in a thread header. */
  size?: 'xs' | 'sm';
  className?: string;
  'data-testid'?: string;
}

export default function DealTagChip({
  customFields, deal, size = 'xs', className = '', ...rest
}: DealTagChipProps) {
  const tag = dealTagFor({ customFields, deal });
  if (!tag) return null;

  const builder = tag.kind === 'builder';
  const Icon = builder ? Hammer : Home;

  return (
    <span
      // The full address on hover, because the chip is truncated and a
      // postcode is what you need when two streets share a name.
      title={`${builder ? 'Builder for' : 'House'}: ${tag.full}`}
      data-testid={rest['data-testid'] ?? 'deal-tag-chip'}
      data-deal-kind={tag.kind}
      className={cn(
        'inline-flex items-center gap-1 rounded font-semibold max-w-full',
        size === 'xs'
          ? 'text-[9.5px] px-1.5 py-[1px]'
          : 'text-[11px] px-2 py-0.5',
        builder
          ? 'bg-[#FEF3C7] text-[#92400E]'
          : 'bg-[#EEF2F8] text-[#3C5A87]',
        className,
      )}
    >
      <Icon
        style={size === 'xs' ? { width: 9, height: 9 } : { width: 11, height: 11 }}
        className="flex-shrink-0"
      />
      {builder && (
        <span className="uppercase tracking-wide opacity-70 flex-shrink-0">
          Builder
        </span>
      )}
      <span className="truncate">{tag.label}</span>
    </span>
  );
}
