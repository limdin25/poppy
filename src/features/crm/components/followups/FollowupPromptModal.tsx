// FollowupPromptModal — opens when an agent moves a contact to a stage
// with requires_followup=true (Nurturing, Callback, Interested).
// Captures due-at + optional note and inserts a wk_contact_followups
// row. The persistent banner (FollowupBanner) consumes those rows
// and surfaces them on the top of every /smsv2 page.
//
// Hugo 2026-04-26: "they're obliged to put a follow-up time and the
// notes for what to do on the follow-up."

import { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { Bell, Save, Loader2, X } from 'lucide-react';
import { useFollowups } from '../../hooks/useFollowups';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  contactName: string;
  columnId: string;
  columnName: string;
  /** Suggested default for due_at — e.g. "1h from now" for Callback,
   *  "tomorrow morning" for Interested, "1 week" for Nurturing. */
  suggestedHoursAhead?: number;
  /** Optional active call id to associate the follow-up with. */
  callId?: string | null;
  onSaved?: () => void;
}

const PRESETS: { label: string; hours: number }[] = [
  { label: '1h', hours: 1 },
  { label: '2h', hours: 2 },
  { label: 'Tomorrow 9am', hours: 0 }, // computed at apply time
  { label: '3 days', hours: 24 * 3 },
  { label: '1 week', hours: 24 * 7 },
];

function tomorrowMorningISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return toLocalIsoForInput(d);
}

function toLocalIsoForInput(d: Date): string {
  // <input type="datetime-local" /> wants `YYYY-MM-DDTHH:mm` in LOCAL
  // time (no timezone suffix). The browser then sends back the same
  // local format which we reinterpret as local time on save.
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(localValue: string): string {
  // Parse the local-time string the browser hands back. Treat as local
  // time, convert to UTC ISO for storage.
  const d = new Date(localValue);
  return d.toISOString();
}

export default function FollowupPromptModal({
  open,
  onOpenChange,
  contactId,
  contactName,
  columnId,
  columnName,
  suggestedHoursAhead = 24,
  callId = null,
  onSaved,
}: Props) {
  const { create, error: hookError } = useFollowups();
  const [dueLocal, setDueLocal] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      const d = new Date(Date.now() + suggestedHoursAhead * 60 * 60 * 1000);
      setDueLocal(toLocalIsoForInput(d));
      setNote('');
    }
  }, [open, suggestedHoursAhead]);

  const applyPreset = (p: (typeof PRESETS)[number]) => {
    if (p.label === 'Tomorrow 9am') {
      setDueLocal(tomorrowMorningISO());
    } else {
      const d = new Date(Date.now() + p.hours * 60 * 60 * 1000);
      setDueLocal(toLocalIsoForInput(d));
    }
  };

  const submit = async () => {
    if (!dueLocal || submitting) return;
    // PR 109 (Hugo 2026-04-28): warn if the picked time falls outside
    // working hours (10 AM – 7 PM local). Confirm-only — agent can still
    // proceed if intentional. Skip path is unaffected; this only fires
    // on the explicit Save path.
    const due = new Date(localInputToIso(dueLocal));
    const hour = due.getHours();
    const outsideHours = hour < 10 || hour >= 19;
    if (outsideHours) {
      const ok = window.confirm(
        `This is outside working hours (10 AM – 7 PM).\n\n` +
          `You picked ${due.toLocaleString()}.\n\n` +
          `Are you sure you want to schedule this follow-up?`
      );
      if (!ok) return;
    }
    setSubmitting(true);
    try {
      const result = await create({
        contact_id: contactId,
        column_id: columnId,
        call_id: callId,
        due_at: localInputToIso(dueLocal),
        note: note.trim() || null,
      });
      if (result) {
        onSaved?.();
        onOpenChange(false);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[350] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={() => onOpenChange(false)} />
      <div className="relative bg-white rounded-2xl shadow-[0_24px_64px_rgba(0,0,0,0.25)] w-full max-w-md mx-4 p-6">
        <button
          onClick={() => onOpenChange(false)}
          className="absolute top-3 right-3 text-[#6B7280] hover:text-[#1A1A1A]"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="mb-4">
          <h2 className="flex items-center gap-2 text-[16px] font-semibold text-[#1A1A1A]">
            <Bell className="w-4 h-4 text-[#1E9A80]" />
            Follow-up for {contactName}
          </h2>
          <p className="text-[13px] text-[#6B7280] mt-1">
            Moving to <span className="font-semibold">{columnName}</span> — set
            when to follow up. The banner at the top of the screen will remind
            you the moment the time arrives.
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-[#525252] mb-1.5">
              Due
            </label>
            <input
              type="datetime-local"
              value={dueLocal}
              onChange={(e) => setDueLocal(e.target.value)}
              className="w-full px-3 py-2 text-[13px] border border-[#E5E5E5] rounded-[10px] focus:outline-none focus:ring-1 focus:ring-[#1E9A80]/30 focus:border-[#1E9A80]"
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => applyPreset(p)}
                  className="text-[10px] font-medium border border-[#E5E7EB] rounded-full px-2 py-0.5 hover:border-[#1E9A80]/60 hover:text-[#1E9A80]"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-[#525252] mb-1.5">
              What to do (optional)
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="e.g. Send the deal pack and confirm budget."
              className="w-full px-3 py-2 text-[12px] border border-[#E5E5E5] rounded-[10px] focus:outline-none focus:ring-1 focus:ring-[#1E9A80]/30 focus:border-[#1E9A80] resize-none"
            />
          </div>
          {hookError && (
            <div className="text-[12px] text-[#EF4444] bg-[#FEF2F2] border border-[#FEE2E2] rounded-md px-3 py-2">
              {hookError}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            className="px-3 py-1.5 text-[12px] font-medium border border-[#E5E7EB] rounded-[8px] hover:bg-[#F3F3EE] disabled:opacity-50"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!dueLocal || submitting}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold bg-[#1E9A80] text-white rounded-[8px] hover:bg-[#1E9A80]/90 disabled:opacity-50"
          >
            {submitting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            {submitting ? 'Saving…' : 'Save follow-up'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
