// The builder viewing, booked without leaving the call.
//
// Hugo, 2026-08-19: "build a calendar next to the call disposition. If you
// book a builder we can add the date there right after the call. UK time.
// And it reflects on the cockpit's calendar."
//
// WHY IT LEFT PostCallPanel AND MOVED LEFT (2026-08-21). It only ever
// appeared AFTER the call ended, in the middle column, below the disposition
// grid. On 21 August Pedro booked two viewings and typed both into the quick
// note instead:
//
//   Dourish & Day  "booked with the builder for the 26th of august 2026, at 2:30 PM"
//   Ben Rose       "Booked for friday at 2pm august 28, need to find a builder"
//
// Both real, both agreed on the phone, and neither reached the property. The
// builder sweep then found two cards in Viewing booked with no viewing time
// and refused to invite anybody, because the approved WhatsApp template says
// "are you able to visit at {address} on {date}" and there was no date to put
// in it. Hugo: "i think dispostion after call to book a time is not working,
// or no obvious for pedro t click."
//
// He was right. So this now lives in COLUMN ONE of the property room, on
// screen for the whole call rather than after it, next to the next step and
// above the Houses list. It is the same component in both places on purpose:
// two copies of a booking form is how one of them quietly stops writing the
// note.
//
// The time is typed as UK wall time whatever zone the agent sits in (Pedro is
// in the Philippines), and the note travels with the booking so the calendar
// card is not a bare time: his first booking saved without one and the card
// told nobody anything.

import { useEffect, useState } from 'react';
import { HardHat, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/browser';
import { ukInputToIso, ukLabel } from '../../lib/ukTime';

export default function BuilderViewingBox({
  propertyOptions, quickNote = '', className = 'mt-5',
}: {
  propertyOptions: Array<{ id: string; address: string | null }>;
  /** The post-call quick note, used as the calendar note when the field below
   *  is left empty. Absent in the live column, where there is no quick note
   *  yet, which is exactly why the field below exists. */
  quickNote?: string;
  className?: string;
}) {
  const [propId, setPropId] = useState(propertyOptions[0]?.id ?? '');
  useEffect(() => {
    if (!propId && propertyOptions[0]?.id) setPropId(propertyOptions[0].id);
  }, [propertyOptions, propId]);
  const [dueLocal, setDueLocal] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!propId || !dueLocal || saving) return;
    setSaving(true);
    setError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) throw new Error('Not signed in');
      const iso = ukInputToIso(dueLocal);
      const res = await fetch('/api/crm/book-viewing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        // The quick note is the fallback: Pedro types the booking words
        // there first, and losing them was the whole bug.
        body: JSON.stringify({ propertyId: propId, at: iso, note: note.trim() || quickNote.trim() || null }),
      });
      const raw = await res.text();
      let json: { ok?: boolean; error?: string };
      try { json = JSON.parse(raw) as typeof json; } catch { json = { error: `HTTP ${res.status}` }; }
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'Could not book it');
      setSavedAt(iso);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not book it');
    } finally {
      setSaving(false);
    }
  };

  if (savedAt) {
    return (
      <div
        className={`${className} rounded-[12px] border border-[#BBD4BE] bg-[#EDF6EE] px-3 py-2.5 text-[12px] text-[#1A3A24]`}
        data-testid="builder-viewing-booked"
      >
        <HardHat className="inline w-3.5 h-3.5 mr-1 -mt-0.5 text-[#2E7D46]" />
        Builder viewing booked for <b>{ukLabel(savedAt)}</b> UK. It is on the cockpit
        calendar, note included. Hugo sorts out which builder goes.
      </div>
    );
  }

  return (
    <div className={`${className} rounded-[12px] border border-[#E5E7EB] bg-white p-3`} data-testid="builder-viewing-box">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-[#9CA3AF] font-semibold mb-2">
        <HardHat className="w-3.5 h-3.5 text-[#3C5A87]" />
        Book the builder viewing (UK time)
      </div>
      {propertyOptions.length > 1 && (
        <select
          value={propId}
          onChange={(e) => setPropId(e.target.value)}
          className="w-full mb-2 px-2 py-1.5 text-[12px] border border-[#E5E5E5] rounded-[8px] bg-white"
        >
          {propertyOptions.map((p) => (
            <option key={p.id} value={p.id}>{(p.address ?? 'Unnamed house').split(',')[0]}</option>
          ))}
        </select>
      )}
      <div className="flex gap-2">
        <input
          type="datetime-local"
          value={dueLocal}
          onChange={(e) => setDueLocal(e.target.value)}
          data-testid="builder-viewing-when"
          className="flex-1 min-w-0 px-2 py-1.5 text-[12px] border border-[#E5E5E5] rounded-[8px] focus:outline-none focus:ring-1 focus:ring-[#3C5A87]/30"
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={!propId || !dueLocal || saving}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold bg-[#3C5A87] text-white rounded-[8px] hover:bg-[#3C5A87]/90 disabled:opacity-50 flex-shrink-0"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <HardHat className="w-3.5 h-3.5" />}
          Book it
        </button>
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note for the calendar"
        className="w-full mt-2 px-2 py-1.5 text-[12px] border border-[#E5E5E5] rounded-[8px] focus:outline-none focus:ring-1 focus:ring-[#3C5A87]/30"
      />
      {error && <div className="mt-1.5 text-[11px] text-[#EF4444]">{error}</div>}
    </div>
  );
}
