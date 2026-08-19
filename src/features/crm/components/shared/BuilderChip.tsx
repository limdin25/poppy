// The builder glued to the deal card (Hugo, 2026-08-20: "they stick together
// and then they are synced, so you know"). Rendered wherever the deal card
// is drawn once a builder is CONFIRMED onto the viewing, and clicking it
// opens the builder's own WhatsApp thread, so the branch card and the builder
// thread point at each other.

import { HardHat } from 'lucide-react';
import { cn } from '@/core/lib/cn';

function viewingLabel(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const date = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London',
  }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Europe/London',
  }).format(d).replace(/\s/g, '').toLowerCase();
  return `${date} ${time}`;
}

export default function BuilderChip({ builder, onOpenThread, className }: {
  builder: { name?: string; viewing_at?: string; contact_id?: string } | null | undefined;
  /** Opens the builder's inbox thread; only offered when we know the contact. */
  onOpenThread?: (contactId: string) => void;
  className?: string;
}) {
  if (!builder?.name) return null;
  const when = viewingLabel(builder.viewing_at);
  const clickable = Boolean(builder.contact_id && onOpenThread);
  return (
    <button
      type="button"
      data-testid="builder-chip"
      disabled={!clickable}
      onClick={(e) => {
        e.stopPropagation();
        if (builder.contact_id && onOpenThread) onOpenThread(builder.contact_id);
      }}
      title={clickable ? 'Open the builder\'s WhatsApp thread' : undefined}
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10.5px] font-medium text-emerald-800',
        clickable && 'hover:bg-emerald-100 cursor-pointer',
        className,
      )}
    >
      <HardHat className="h-3 w-3 flex-shrink-0" />
      <span className="truncate">
        {builder.name}
        {when ? ` · viewing ${when}` : ''}
      </span>
    </button>
  );
}
