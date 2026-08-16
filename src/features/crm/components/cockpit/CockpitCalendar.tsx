// What has to happen, and when.
//
// Hugo, 2026-08-16: "we can see the calendar and this calendar you can see all
// the follow-ups and everything that has to be done in the future, so we know
// when we have to follow up."
//
// Across every deal, not one at a time, because a calendar that only shows the
// house you happen to have selected is not a calendar.
//
// OVERDUE SITS AT THE TOP, not in the past where it belongs chronologically.
// Something already missed is the most useful thing on this page, and sorting
// purely by time is exactly how it stays missed.

import { CalendarClock, HardHat, AlertTriangle } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import type { CalendarItem } from './types';

/** Today, tomorrow, or the date. Nobody reads "17 Aug" and thinks "tomorrow". */
function dayLabel(iso: string, now: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const fmt = (x: Date) => x.toLocaleDateString('en-GB', {
    timeZone: 'Europe/London', day: '2-digit', month: '2-digit', year: 'numeric',
  });
  const today = fmt(now);
  const tomorrow = fmt(new Date(now.getTime() + 86_400_000));
  const on = fmt(d);
  if (on === today) return 'Today';
  if (on === tomorrow) return 'Tomorrow';
  return d.toLocaleDateString('en-GB', {
    timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short',
  });
}

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', {
    timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit',
  });

export default function CockpitCalendar({ items, overdue, loading, onOpen }: {
  items: CalendarItem[];
  overdue: number;
  loading: boolean;
  onOpen: (propertyId: string) => void;
}) {
  const now = new Date();

  if (loading) {
    return (
      <div className="space-y-2 p-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-md bg-[#F3F4F6]" />
        ))}
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="px-4 py-8 text-center text-[12px] italic text-ink-subtle">
        Nothing is booked. Every follow-up somebody promises on a call, and every
        builder viewing, shows up here.
      </div>
    );
  }

  // Group by day, keeping the server's order (overdue first, then soonest).
  const groups: Array<{ label: string; overdue: boolean; items: CalendarItem[] }> = [];
  for (const item of items) {
    const label = item.overdue ? 'Overdue' : dayLabel(item.at, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, overdue: item.overdue, items: [item] });
  }

  return (
    <div data-testid="cockpit-calendar">
      {overdue > 0 && (
        <div className="flex items-center gap-1.5 border-b border-border bg-[#FEF2F2] px-3 py-2 text-[11.5px] text-[#DC2626]">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          {overdue} {overdue === 1 ? 'thing is' : 'things are'} already past their time.
        </div>
      )}

      {groups.map((g) => (
        <div key={`${g.label}-${g.items[0].id}`}>
          <div className={cn(
            'sticky top-0 border-b border-border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider',
            g.overdue ? 'bg-[#FEF2F2] text-[#DC2626]' : 'bg-elevated text-ink-subtle',
          )}>
            {g.label}
          </div>
          <ul className="divide-y divide-border">
            {g.items.map((it) => {
              const Icon = it.kind === 'viewing' ? HardHat : CalendarClock;
              return (
                <li key={it.id}>
                  <button
                    type="button"
                    disabled={!it.propertyId}
                    onClick={() => it.propertyId && onOpen(it.propertyId)}
                    data-testid="cockpit-calendar-item"
                    className="w-full px-3 py-2 text-left transition-colors enabled:hover:bg-[#F9FAFB] disabled:cursor-default"
                  >
                    <div className="flex items-start gap-2">
                      <Icon className={cn(
                        'mt-0.5 w-3.5 h-3.5 flex-shrink-0',
                        it.overdue ? 'text-[#DC2626]' : 'text-ink-subtle',
                      )} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="text-[12px] font-semibold text-ink">{it.title}</span>
                          <span className={cn(
                            'text-[10px] tabular-nums',
                            it.overdue ? 'text-[#DC2626]' : 'text-ink-muted',
                          )}>
                            {time(it.at)}
                          </span>
                        </div>
                        {it.address && (
                          <p className="truncate text-[11px] text-ink-muted">{it.address}</p>
                        )}
                        {it.note && (
                          <p className="mt-0.5 text-[11px] leading-snug text-[#374151]">{it.note}</p>
                        )}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
