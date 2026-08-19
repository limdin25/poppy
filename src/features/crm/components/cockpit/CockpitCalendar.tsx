// What has to happen, and when: a real month calendar.
//
// Hugo, 2026-08-16: "we can see the calendar and this calendar you can see all
// the follow-ups and everything that has to be done in the future, so we know
// when we have to follow up." And 2026-08-19, looking at the list this used to
// be: "the calendar on the cockpit is only showing as a list, it should show
// as a Google calendar. Same format, normal calendar."
//
// So: a month grid, Monday first, UK time throughout (the deals are UK houses
// and UK branches; Pedro dials from the Philippines and his browser's idea of
// "today" is not the business's). Clicking a day opens its bookings below the
// grid IN FULL, note included: Pedro's booking note was invisible on the old
// cards ("it doesnt show my note about the viewing schedule", 2026-08-19), so
// the day view and the chips both carry it now.
//
// OVERDUE IS NOT BURIED. Something already missed is the most useful thing on
// this page, so overdue items keep their own red strip above the grid instead
// of scrolling away into last week's cells.

import { useMemo, useState } from 'react';
import {
  CalendarClock, HardHat, AlertTriangle, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { ukDateKey } from '../../lib/ukTime';
import type { CalendarItem } from './types';

const LONDON = 'Europe/London';

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', {
    timeZone: LONDON, hour: '2-digit', minute: '2-digit',
  });

/** {year, month} of an instant, London's idea of it. month is 1 to 12. */
function ukYearMonth(d: Date): { y: number; m: number } {
  const key = ukDateKey(d);
  return { y: Number(key.slice(0, 4)), m: Number(key.slice(5, 7)) };
}

/** Every day key of a month, plus leading blanks so the 1st sits under its weekday. */
function monthCells(y: number, m: number): Array<string | null> {
  // Weekday of the 1st, Monday=0. Date.UTC is safe here: a calendar DATE has
  // no zone, only its weekday label needs computing.
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: Array<string | null> = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

const MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function DayCard({ it, onOpen }: { it: CalendarItem; onOpen: (propertyId: string) => void }) {
  const Icon = it.kind === 'viewing' ? HardHat : CalendarClock;
  return (
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
              {timeOf(it.at)}
            </span>
          </div>
          {it.address && (
            <p className="truncate text-[11px] text-ink-muted">{it.address}</p>
          )}
          {/* The note, in full. This is the line Pedro could not see. */}
          {it.note && (
            <p className="mt-0.5 whitespace-pre-wrap text-[11px] leading-snug text-[#374151]">{it.note}</p>
          )}
        </div>
      </div>
    </button>
  );
}

export default function CockpitCalendar({ items, overdue, loading, onOpen }: {
  items: CalendarItem[];
  overdue: number;
  loading: boolean;
  onOpen: (propertyId: string) => void;
}) {
  const todayKey = ukDateKey(new Date());
  const [view, setView] = useState(() => ukYearMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState<string>(todayKey);

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const it of items) {
      const key = ukDateKey(it.at);
      const list = map.get(key) ?? [];
      list.push(it);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    }
    return map;
  }, [items]);

  const overdueItems = useMemo(() => items.filter((i) => i.overdue), [items]);

  if (loading) {
    return (
      <div className="space-y-2 p-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-md bg-[#F3F4F6]" />
        ))}
      </div>
    );
  }

  const cells = monthCells(view.y, view.m);
  const move = (dir: -1 | 1) => {
    setView((v) => {
      const m = v.m + dir;
      if (m < 1) return { y: v.y - 1, m: 12 };
      if (m > 12) return { y: v.y + 1, m: 1 };
      return { y: v.y, m };
    });
  };
  const selectedItems = byDay.get(selectedDay) ?? [];

  return (
    <div data-testid="cockpit-calendar">
      {overdue > 0 && (
        <div className="flex items-center gap-1.5 border-b border-border bg-[#FEF2F2] px-3 py-2 text-[11.5px] text-[#DC2626]">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          {overdue} {overdue === 1 ? 'thing is' : 'things are'} already past their time.
        </div>
      )}
      {overdueItems.length > 0 && (
        <div className="border-b border-border bg-[#FFF7F7]">
          <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[#DC2626]">
            Overdue
          </div>
          <ul className="divide-y divide-[#FBE4E4]">
            {overdueItems.map((it) => (
              <li key={it.id}><DayCard it={it} onOpen={onOpen} /></li>
            ))}
          </ul>
        </div>
      )}

      {/* The month, UK time. */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <button
          type="button"
          onClick={() => move(-1)}
          aria-label="Previous month"
          className="p-1 rounded-md text-ink-subtle hover:bg-[#F3F4F6]"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2">
          <span className="text-[12.5px] font-semibold text-ink">
            {MONTH_LABELS[view.m - 1]} {view.y}
          </span>
          <button
            type="button"
            onClick={() => { setView(ukYearMonth(new Date())); setSelectedDay(todayKey); }}
            className="text-[10px] font-semibold text-[#3C5A87] border border-[#E5E7EB] rounded-full px-2 py-0.5 hover:border-[#3C5A87]/50"
          >
            Today
          </button>
        </div>
        <button
          type="button"
          onClick={() => move(1)}
          aria-label="Next month"
          className="p-1 rounded-md text-ink-subtle hover:bg-[#F3F4F6]"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 border-b border-border text-center text-[9px] font-bold uppercase tracking-wider text-ink-subtle">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div key={d} className="py-1">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 border-b border-border" data-testid="cockpit-calendar-grid">
        {cells.map((key, i) => {
          if (!key) return <div key={`blank-${i}`} className="min-h-[52px] border-b border-r border-[#F3F4F6] bg-[#FAFAF8]" />;
          const dayItems = byDay.get(key) ?? [];
          const isToday = key === todayKey;
          const isSelected = key === selectedDay;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setSelectedDay(key)}
              className={cn(
                'min-h-[52px] border-b border-r border-[#F3F4F6] px-0.5 pb-0.5 text-left align-top transition-colors',
                isSelected ? 'bg-[#EEF2F8] ring-1 ring-inset ring-[#3C5A87]/40' : 'hover:bg-[#F9FAFB]',
              )}
            >
              <div className={cn(
                'mx-auto mt-0.5 grid h-5 w-5 place-items-center rounded-full text-[10px] tabular-nums',
                isToday ? 'bg-[#3C5A87] font-bold text-white' : 'text-ink-muted',
              )}>
                {Number(key.slice(8, 10))}
              </div>
              <div className="space-y-0.5">
                {dayItems.slice(0, 3).map((it) => (
                  <div
                    key={it.id}
                    title={[timeOf(it.at), it.title, it.note ?? ''].filter(Boolean).join(' · ')}
                    className={cn(
                      'truncate rounded px-1 py-px text-[8.5px] leading-tight',
                      it.overdue
                        ? 'bg-[#FEE2E2] text-[#B91C1C]'
                        : it.kind === 'viewing'
                          ? 'bg-[#E7F0E9] text-[#2E7D46]'
                          : 'bg-[#EEF2F8] text-[#3C5A87]',
                    )}
                  >
                    {timeOf(it.at)} {it.title}
                  </div>
                ))}
                {dayItems.length > 3 && (
                  <div className="px-1 text-[8.5px] text-ink-subtle">+{dayItems.length - 3} more</div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* The opened day, in full: every booking with its note. */}
      <div data-testid="cockpit-calendar-day">
        <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-subtle bg-elevated border-b border-border">
          {selectedDay === todayKey ? 'Today' : new Date(`${selectedDay}T12:00:00Z`).toLocaleDateString('en-GB', {
            weekday: 'long', day: 'numeric', month: 'long',
          })}
        </div>
        {selectedItems.length === 0 ? (
          <div className="px-4 py-5 text-center text-[11.5px] italic text-ink-subtle">
            Nothing booked this day.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {selectedItems.map((it) => (
              <li key={it.id}><DayCard it={it} onOpen={onOpen} /></li>
            ))}
          </ul>
        )}
        {items.length === 0 && (
          <div className="px-4 py-4 text-center text-[11.5px] italic text-ink-subtle">
            Every follow-up somebody promises on a call, and every builder viewing,
            shows up here.
          </div>
        )}
      </div>
    </div>
  );
}
