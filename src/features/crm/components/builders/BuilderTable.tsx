// Who can walk this house, and where each one has got to.
//
// The status column is the whole point: eleven builders replied across eight
// houses on 2026-08-24 and only two were confirmed, because nobody could see at
// a glance which ones were waiting on an answer.
//
// LANDLINES ARE LABELLED, NOT HIDDEN. draftOutreachForProperty only ever
// messages UK mobiles, because WhatsApp cannot reach a landline. A scrape that
// finds eleven builders of which four are landlines looks like a broken send
// unless the table says "call only" out loud.

import { cn } from '@/core/lib/cn';
import { Phone } from 'lucide-react';

export interface BuilderRow {
  id: string;
  name: string;
  phone: string | null;
  isMobile: boolean;
  coverage: string[];
  notes: string | null;
  outreachId: string | null;
  status: string | null;
  blockedReason: string | null;
  contactId: string | null;
  sentAt: string | null;
  repliedAt: string | null;
  confirmedAt: string | null;
  error: string | null;
}

interface Props {
  builders: BuilderRow[];
  selected: Set<string>;
  onToggle: (id: string, on: boolean) => void;
  onToggleAll: (on: boolean) => void;
}

/** Google Places writes the review count into `notes` as prose, and it is the
 *  only quality signal we hold, so it is worth digging back out for the table
 *  rather than adding a column to the roster for it. */
function reviewsOf(notes: string | null): string | null {
  const m = String(notes ?? '').match(/\((\d+) reviews?(?:, ([\d.]+))?\)/);
  if (!m) return null;
  return m[2] ? `${m[1]} reviews, ${m[2]}` : `${m[1]} reviews`;
}

const STATUS: Record<string, { text: string; cls: string }> = {
  confirmed: { text: 'Coming', cls: 'bg-[#EDF6EE] text-[#2E7D46] border-[#BBD4BE]' },
  replied: { text: 'Replied, waiting on us', cls: 'bg-[#FFFBEB] text-[#B45309] border-[#F59E0B]' },
  sent: { text: 'Invited', cls: 'bg-[#EEF2F8] text-[#3C5A87] border-[#D8E1EE]' },
  declined: { text: 'Said no', cls: 'bg-[#F3F4F6] text-[#6B7280] border-[#E5E7EB]' },
  failed: { text: 'Send failed', cls: 'bg-[#FEF2F2] text-[#DC2626] border-[#DC2626]/30' },
  skipped: { text: 'Skipped', cls: 'bg-[#F3F4F6] text-[#9CA3AF] border-[#E5E7EB]' },
  draft: { text: 'Not sent yet', cls: 'bg-white text-[#9CA3AF] border-[#E5E7EB]' },
};

export default function BuilderTable({ builders, selected, onToggle, onToggleAll }: Props) {
  if (!builders.length) {
    return (
      <p className="py-8 text-center text-[12px] italic text-[#9CA3AF]">
        No builder on the roster covers this area yet. Press Find builders above.
      </p>
    );
  }

  // Only an uninvited mobile can be selected: a landline cannot receive the
  // invite, and somebody already invited must not be invited twice.
  const selectable = builders.filter((b) => b.isMobile && !b.status);
  const allOn = selectable.length > 0 && selectable.every((b) => selected.has(b.id));

  return (
    <div className="overflow-x-auto rounded-[10px] border border-[#E5E7EB]">
      <table className="w-full min-w-[560px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-[#E5E7EB] bg-[#FAFAF8]">
            <th className="w-8 px-2 py-2">
              <input
                type="checkbox"
                aria-label="Select every builder who can be invited"
                checked={allOn}
                disabled={!selectable.length}
                onChange={(e) => onToggleAll(e.target.checked)}
                className="h-3.5 w-3.5 accent-[#3C5A87]"
              />
            </th>
            <th className="px-2 py-2 text-left text-[9.5px] font-bold uppercase tracking-wider text-[#9CA3AF]">Builder</th>
            <th className="px-2 py-2 text-left text-[9.5px] font-bold uppercase tracking-wider text-[#9CA3AF]">Phone</th>
            <th className="px-2 py-2 text-left text-[9.5px] font-bold uppercase tracking-wider text-[#9CA3AF]">Where they are</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#F3F4F6]">
          {builders.map((b) => {
            const on = selected.has(b.id);
            const canPick = b.isMobile && !b.status;
            const pill = b.status ? STATUS[b.status] ?? { text: b.status, cls: 'bg-[#F3F4F6] text-[#6B7280] border-[#E5E7EB]' } : null;
            const reviews = reviewsOf(b.notes);
            return (
              <tr
                key={b.id}
                data-testid="builder-row"
                className={cn('align-top', on ? 'bg-[#EEF2F8]' : 'hover:bg-[#F9FAFB]')}
              >
                <td className="px-2 py-2">
                  <input
                    type="checkbox"
                    aria-label={`Invite ${b.name}`}
                    checked={on}
                    disabled={!canPick}
                    onChange={(e) => onToggle(b.id, e.target.checked)}
                    className="h-3.5 w-3.5 accent-[#3C5A87] disabled:opacity-30"
                  />
                </td>
                <td className="px-2 py-2">
                  <div className="text-[12.5px] font-medium text-[#1A1A1A]">{b.name}</div>
                  {reviews ? <div className="text-[10.5px] text-[#9CA3AF]">{reviews}</div> : null}
                </td>
                <td className="px-2 py-2">
                  <div className="font-mono text-[11.5px] tabular-nums text-[#374151]">{b.phone ?? 'no number'}</div>
                  {!b.isMobile ? (
                    <div className="inline-flex items-center gap-0.5 text-[10px] text-[#B45309]">
                      <Phone className="h-2.5 w-2.5" /> call only, no WhatsApp
                    </div>
                  ) : null}
                </td>
                <td className="px-2 py-2">
                  {pill ? (
                    <span className={cn('inline-block rounded-full border px-2 py-[1px] text-[10.5px] font-medium', pill.cls)}>
                      {pill.text}
                    </span>
                  ) : (
                    <span className="text-[11px] text-[#9CA3AF]">not invited</span>
                  )}
                  {b.error ? <div className="mt-0.5 text-[10.5px] text-[#DC2626]">{b.error}</div> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
