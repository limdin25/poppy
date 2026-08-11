// CallTimeline — bottom of COL 1 of LiveCallScreen, BELOW the SMS sender.
//
// Hugo 2026-04-30 (PR B): SMS-only. Coach lines + activity rows were
// noise in the small col-1 panel; coach lives in col 2 already, and
// activity is surfaced in PastCallScreen + the contact timeline. Here
// we just want a quick "did the SMS land?" view.

import { useMemo } from 'react';
import { Clock, MessageSquare } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { useCallTimeline, type TimelineRow } from '../../hooks/useCallTimeline';
import { formatTimeOnly } from '../../data/helpers';

interface Props {
  callId: string | null;
}

export default function CallTimeline({ callId }: Props) {
  const { items, loading } = useCallTimeline(callId);

  // SMS-only — sends + receives during the call. Everything else (coach,
  // notes, stage moves) is surfaced elsewhere.
  const filtered = useMemo(
    () => items.filter((r) => r.kind === 'sms'),
    [items]
  );

  if (!callId) {
    return (
      <div className="text-[11px] text-[#9CA3AF] italic px-1 py-2">
        SMS history appears once a call connects.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-[#9CA3AF] mb-1">
        <Clock className="w-3 h-3" />
        <span>SMS during call</span>
        {filtered.length > 0 && (
          <span className="text-[#6B7280] font-normal ml-0.5">
            · {filtered.length}
          </span>
        )}
      </div>
      {loading && (
        <div className="text-[11px] text-[#9CA3AF]">Loading…</div>
      )}
      {!loading && filtered.length === 0 && (
        <div className="text-[11px] text-[#9CA3AF] italic">
          No SMS sent yet on this call.
        </div>
      )}
      <div className="space-y-1.5 max-h-[300px] overflow-y-auto pr-1">
        {filtered.map((row, idx) => (
          <SmsEntry key={`${row.ref_id ?? idx}-${row.kind}`} row={row} />
        ))}
      </div>
    </div>
  );
}

function SmsEntry({ row }: { row: TimelineRow }) {
  const time = formatTimeOnly(row.ts);
  const outbound = row.subtype === 'outbound';
  return (
    <div
      className={cn(
        'rounded-lg px-2 py-1.5 text-[11px] border',
        outbound
          ? 'bg-[#3C5A87]/10 border-[#3C5A87]/30 ml-3'
          : 'bg-[#F3F3EE] border-[#E5E7EB] mr-3'
      )}
    >
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-wide font-semibold text-[#6B7280] mb-0.5">
        <MessageSquare className="w-2.5 h-2.5" />
        {outbound ? 'Sent' : 'Received'}
        <span className="ml-auto tabular-nums font-normal">{time}</span>
      </div>
      {/* Same fault as the inbox bubble had (2026-08-11): without a whitespace
          rule every newline collapses, so an email read as one wall of text
          while Pedro was on the phone. */}
      <div className="text-[#1A1A1A] leading-snug whitespace-pre-wrap break-words">{row.body}</div>
    </div>
  );
}
