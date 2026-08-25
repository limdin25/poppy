// The list Pedro works down: ring one, say what happened, text him the details.
//
// Hugo, 2026-08-25: "it's gonna be just a list, he can call and then from there
// he can SMS ... he can make calls directly click to call and then he can put
// the drop-down outcome of the call, simple, even after the call. Then he can
// click to SMS and SMS the details."
//
// THE ORDER OF THE ROW IS THE ORDER OF THE JOB. Call, outcome, text. That is
// what Hugo described and it is also the sequence that works: a builder who has
// just spoken to a human is expecting the address, and a text that arrives cold
// is a text that gets ignored. The old table had one thing on it, a tick box for
// a WhatsApp template that was blocked on Meta anyway.
//
// LANDLINES ARE LABELLED, NOT HIDDEN. Neither channel can reach one, but a
// phone can, and on a thin outcode half the list is landlines. Ringing one is
// the whole job, so it gets the Call button and loses only the tick box.
//
// THE CALL OUTCOME IS NOT THE ROW'S STATUS, on purpose. "He says he is coming"
// and "we have told him where to go" are different facts, and collapsing them is
// how a house ends up with a builder who was never sent an address.

import { cn } from '@/core/lib/cn';
import { MessageSquare, Phone, PhoneCall } from 'lucide-react';

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
  smsSentAt: string | null;
  whatsappSentAt: string | null;
  callOutcome: string | null;
  callOutcomeAt: string | null;
}

/** Kept in step with CALL_OUTCOMES in api/lib/builder-outreach.ts, which is the
 *  only thing that will accept a write. A word here that is not a word there is
 *  refused by the server rather than silently stored. */
export const CALL_OUTCOMES: Array<{ id: string; label: string; prompts?: boolean }> = [
  { id: 'coming', label: 'Coming to the viewing', prompts: true },
  { id: 'wants_details', label: 'Wants the details by text', prompts: true },
  { id: 'call_back', label: 'Call back later' },
  { id: 'no_answer', label: 'No answer' },
  { id: 'not_interested', label: 'Not interested' },
  { id: 'wrong_number', label: 'Wrong number' },
];

interface Props {
  builders: BuilderRow[];
  selected: Set<string>;
  onToggle: (id: string, on: boolean) => void;
  onToggleAll: (on: boolean) => void;
  onCall: (b: BuilderRow) => void;
  onText: (b: BuilderRow, kind: 'opener' | 'details') => void;
  onOutcome: (b: BuilderRow, outcome: string) => void;
  /** The builder currently being connected, so the button says so. */
  busyId: string | null;
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
  draft: { text: 'Not written to yet', cls: 'bg-white text-[#9CA3AF] border-[#E5E7EB]' },
};

/** Statuses that mean a message has already gone. A drafted row has NOT been
 *  written to, and treating "draft" as sent is why nobody could tick a builder
 *  once the five-minute sweep had drafted him. */
const ALREADY_SENT = new Set(['sent', 'replied', 'confirmed', 'declined', 'skipped']);

function canPick(b: BuilderRow): boolean {
  return b.isMobile && !ALREADY_SENT.has(String(b.status ?? ''));
}

export default function BuilderTable({
  builders, selected, onToggle, onToggleAll, onCall, onText, onOutcome, busyId,
}: Props) {
  if (!builders.length) {
    return (
      <p className="py-8 text-center text-[12px] italic text-[#9CA3AF]">
        No builder on the roster covers this area yet. Press Find builders above.
      </p>
    );
  }

  const selectable = builders.filter(canPick);
  const allOn = selectable.length > 0 && selectable.every((b) => selected.has(b.id));

  return (
    <div className="overflow-x-auto rounded-[10px] border border-[#E5E7EB]">
      <table className="w-full min-w-[720px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-[#E5E7EB] bg-[#FAFAF8]">
            <th className="w-8 px-2 py-2">
              <input
                type="checkbox"
                aria-label="Select every builder who can be messaged"
                checked={allOn}
                disabled={!selectable.length}
                onChange={(e) => onToggleAll(e.target.checked)}
                className="h-3.5 w-3.5 accent-[#3C5A87]"
              />
            </th>
            <th className="px-2 py-2 text-left text-[9.5px] font-bold uppercase tracking-wider text-[#9CA3AF]">Builder</th>
            <th className="px-2 py-2 text-left text-[9.5px] font-bold uppercase tracking-wider text-[#9CA3AF]">Ring him</th>
            <th className="px-2 py-2 text-left text-[9.5px] font-bold uppercase tracking-wider text-[#9CA3AF]">What he said</th>
            <th className="px-2 py-2 text-left text-[9.5px] font-bold uppercase tracking-wider text-[#9CA3AF]">Where they are</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#F3F4F6]">
          {builders.map((b) => {
            const on = selected.has(b.id);
            const pickable = canPick(b);
            const pill = b.status ? STATUS[b.status] ?? { text: b.status, cls: 'bg-[#F3F4F6] text-[#6B7280] border-[#E5E7EB]' } : null;
            const reviews = reviewsOf(b.notes);
            const busy = busyId === b.id;
            return (
              <tr
                key={b.id}
                data-testid="builder-row"
                className={cn('align-top', on ? 'bg-[#EEF2F8]' : 'hover:bg-[#F9FAFB]')}
              >
                <td className="px-2 py-2">
                  <input
                    type="checkbox"
                    aria-label={`Write to ${b.name}`}
                    checked={on}
                    disabled={!pickable}
                    onChange={(e) => onToggle(b.id, e.target.checked)}
                    className="h-3.5 w-3.5 accent-[#3C5A87] disabled:opacity-30"
                  />
                </td>

                <td className="px-2 py-2">
                  <div className="text-[12.5px] font-medium text-[#1A1A1A]">{b.name}</div>
                  {reviews ? <div className="text-[10.5px] text-[#9CA3AF]">{reviews}</div> : null}
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {b.whatsappSentAt ? <Tag tone="wa">WhatsApp sent</Tag> : null}
                    {b.smsSentAt ? <Tag tone="sms">Texted</Tag> : null}
                  </div>
                </td>

                <td className="px-2 py-2">
                  <div className="font-mono text-[11.5px] tabular-nums text-[#374151]">{b.phone ?? 'no number'}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <button
                      data-testid="builder-call"
                      disabled={!b.phone || busy}
                      onClick={() => onCall(b)}
                      className="inline-flex items-center gap-1 rounded-[7px] bg-[#3C5A87] px-2 py-1 text-[10.5px] font-bold text-white disabled:opacity-40"
                    >
                      <PhoneCall className="h-3 w-3" /> {busy ? 'Calling' : 'Call'}
                    </button>
                    <button
                      data-testid="builder-text"
                      disabled={!b.isMobile}
                      onClick={() => onText(b, b.callOutcome ? 'details' : 'opener')}
                      title={b.isMobile ? 'Text this builder' : 'A landline cannot receive a text'}
                      className="inline-flex items-center gap-1 rounded-[7px] border border-[#E5E7EB] bg-white px-2 py-1 text-[10.5px] font-medium text-[#3C5A87] disabled:opacity-40"
                    >
                      <MessageSquare className="h-3 w-3" /> Text
                    </button>
                  </div>
                  {!b.isMobile ? (
                    <div className="mt-0.5 inline-flex items-center gap-0.5 text-[10px] text-[#B45309]">
                      <Phone className="h-2.5 w-2.5" /> landline, ring only
                    </div>
                  ) : null}
                </td>

                <td className="px-2 py-2">
                  <select
                    data-testid="builder-outcome"
                    aria-label={`What ${b.name} said`}
                    value={b.callOutcome ?? ''}
                    onChange={(e) => onOutcome(b, e.target.value)}
                    className="w-full max-w-[170px] rounded-[7px] border border-[#E5E7EB] bg-white px-1.5 py-1 text-[11px] text-[#374151] focus:outline-none focus:ring-1 focus:ring-[#3C5A87]"
                  >
                    <option value="">Not rung yet</option>
                    {CALL_OUTCOMES.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                  {b.callOutcome && !b.smsSentAt
                    && CALL_OUTCOMES.find((o) => o.id === b.callOutcome)?.prompts ? (
                      <button
                        data-testid="builder-send-details"
                        onClick={() => onText(b, 'details')}
                        className="mt-1 text-[10.5px] font-medium text-[#2E7D46] underline"
                      >
                        Send him the details
                      </button>
                    ) : null}
                </td>

                <td className="px-2 py-2">
                  {pill ? (
                    <span className={cn('inline-block rounded-full border px-2 py-[1px] text-[10.5px] font-medium', pill.cls)}>
                      {pill.text}
                    </span>
                  ) : (
                    <span className="text-[11px] text-[#9CA3AF]">not contacted</span>
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

function Tag({ tone, children }: { tone: 'wa' | 'sms'; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-block rounded-full border px-1.5 py-[1px] text-[9.5px] font-semibold',
        tone === 'wa'
          ? 'border-[#BBD4BE] bg-[#EDF6EE] text-[#2E7D46]'
          : 'border-[#D8E1EE] bg-[#EEF2F8] text-[#3C5A87]',
      )}
    >
      {children}
    </span>
  );
}
