// Pick the house, then find builders for it.
//
// Hugo, 2026-08-24, correcting himself mid-sentence: "instead of put the area,
// we select the property and then he finds builders in the area." Right call.
// A postcode box makes Pedro retype something the house already knows, and the
// outcode is the only thing the search actually needs.
//
// Ordered by how soon the viewing is, because a viewing on Wednesday with no
// builder is the only kind of emergency this screen has. Houses with no time
// booked yet sit at the bottom rather than being hidden: those are the ones
// nobody has noticed.

import { cn } from '@/core/lib/cn';
import { AlertTriangle, Check, HardHat } from 'lucide-react';

export interface PickerProperty {
  id: string;
  address: string | null;
  outcode: string | null;
  viewingAt: string | null;
  viewingLabel: string | null;
  houseNumberKnown: boolean;
  coveringCount: number;
  mobileCount: number;
  invited: number;
  replied: number;
  confirmed: number;
  declined: number;
  assignedBuilderName: string | null;
}

interface Props {
  properties: PickerProperty[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** Short UK day and time, so a list of eight scans in one glance. */
function shortWhen(iso: string | null): string {
  if (!iso) return 'no time booked';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'no time booked';
  return d.toLocaleString('en-GB', {
    timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function PropertyPicker({ properties, selectedId, onSelect }: Props) {
  if (!properties.length) {
    return (
      <p className="px-3 py-6 text-center text-[12px] italic text-[#9CA3AF]">
        No house has a viewing booked yet, so there is nobody to send a builder to.
      </p>
    );
  }

  return (
    <div className="divide-y divide-[#F3F4F6]" data-testid="builder-property-picker">
      {properties.map((p) => {
        const active = p.id === selectedId;
        // What needs doing, in one phrase, decided here so every row reads the
        // same way. Order matters: the loudest true thing wins.
        const need = p.confirmed
          ? { tone: 'good' as const, text: `${p.assignedBuilderName ?? 'A builder'} is coming` }
          : !p.houseNumberKnown && p.invited
            ? { tone: 'bad' as const, text: `${p.invited} invited, none can be told the house number` }
            : p.replied
              ? { tone: 'warn' as const, text: `${p.replied} replied, nobody confirmed` }
              : p.invited
                ? { tone: 'plain' as const, text: `${p.invited} invited, no reply yet` }
                : p.coveringCount
                  ? { tone: 'warn' as const, text: `${p.coveringCount} builders known, none invited` }
                  : { tone: 'bad' as const, text: 'no builders found for this area yet' };

        return (
          <button
            key={p.id}
            data-testid="builder-property-row"
            onClick={() => onSelect(p.id)}
            className={cn(
              'w-full px-3 py-2.5 text-left transition-colors',
              active ? 'bg-[#EEF2F8]' : 'hover:bg-[#F9FAFB]',
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[#1A1A1A]">
                {p.address ?? 'Address missing'}
              </span>
              {p.outcode ? (
                <span className="flex-shrink-0 rounded-full bg-[#F3F3EE] px-1.5 py-[1px] text-[9.5px] font-bold text-[#6B7280]">
                  {p.outcode}
                </span>
              ) : null}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-[#6B7280]">
              <span className={cn(!p.viewingAt && 'italic text-[#9CA3AF]')}>{shortWhen(p.viewingAt)}</span>
              {!p.houseNumberKnown ? (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-[#FEF2F2] px-1.5 py-[1px] font-semibold text-[#DC2626]">
                  <AlertTriangle className="h-2.5 w-2.5" /> no house number
                </span>
              ) : null}
            </div>
            <div
              className={cn(
                'mt-1 inline-flex items-center gap-1 text-[10.5px]',
                need.tone === 'good' && 'font-semibold text-[#2E7D46]',
                need.tone === 'warn' && 'text-[#B45309]',
                need.tone === 'bad' && 'font-semibold text-[#DC2626]',
                need.tone === 'plain' && 'text-[#6B7280]',
              )}
            >
              {need.tone === 'good' ? <Check className="h-3 w-3" /> : <HardHat className="h-3 w-3" />}
              {need.text}
            </div>
          </button>
        );
      })}
    </div>
  );
}
