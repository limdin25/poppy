// The house number, which is the single thing that was losing builder bookings.
//
// Measured on 2026-08-24: eight viewings booked, eleven builders replied, two
// confirmed. Seven of the eight houses had no house number, because Rightmove
// publishes only the street. Builders answered "What number Oxford gardens is
// it and I will book it in the diary" and the thread died with us saying "I am
// getting the number now". The one house that HAD a number, 10 Stevenson
// Avenue, is the one that confirmed cleanly.
//
// So this sits at the top of the panel and is loud when it is missing. It is
// not a detail in a drawer.

import { useState } from 'react';
import { Check, Home, Loader2 } from 'lucide-react';

interface Props {
  known: boolean;
  facingAddress: string;
  streetAddress: string | null;
  busy?: boolean;
  onSave: (typed: string) => Promise<void>;
}

export default function HouseNumberBar({ known, facingAddress, streetAddress, busy, onSave }: Props) {
  const [typed, setTyped] = useState('');
  const [saving, setSaving] = useState(false);

  if (known) {
    return (
      <div
        data-testid="house-number-known"
        className="flex items-center gap-2 rounded-[10px] border border-[#BBD4BE] bg-[#EDF6EE] px-3 py-2"
      >
        <Check className="h-3.5 w-3.5 flex-shrink-0 text-[#2E7D46]" />
        <span className="text-[11.5px] text-[#2E7D46]">
          Builders are told <strong className="font-semibold">{facingAddress}</strong>
        </span>
      </div>
    );
  }

  const preview = typed.trim() && streetAddress ? `${typed.trim()}, ${streetAddress}` : '';

  const save = async () => {
    if (!typed.trim() || saving) return;
    setSaving(true);
    try {
      await onSave(typed.trim());
      setTyped('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      data-testid="house-number-missing"
      className="rounded-[10px] border border-[#DC2626]/40 bg-[#FEF2F2] px-3 py-2.5"
    >
      <div className="flex items-start gap-2">
        <Home className="mt-[2px] h-3.5 w-3.5 flex-shrink-0 text-[#DC2626]" />
        <div className="min-w-0 flex-1">
          <p className="text-[11.5px] font-semibold text-[#DC2626]">No house number on this advert.</p>
          <p className="mt-0.5 text-[11px] text-[#7F1D1D]">
            Builders ask which house it is and the thread stops while somebody goes and finds out.
            The branch put it in the viewing confirmation email.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              data-testid="house-number-input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}
              placeholder="10"
              className="w-20 rounded-[8px] border border-[#E5E7EB] bg-white px-2 py-1 text-[12px] text-[#1A1A1A] focus:outline-none focus:ring-1 focus:ring-[#3C5A87]"
            />
            <button
              data-testid="house-number-save"
              onClick={() => void save()}
              disabled={!typed.trim() || saving || busy}
              className="inline-flex items-center gap-1.5 rounded-[8px] bg-[#3C5A87] px-3 py-1.5 text-[11.5px] font-bold text-white disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Save the number
            </button>
            {preview ? (
              <span className="truncate text-[11px] text-[#7F1D1D]">
                Builders will be told: <strong className="font-semibold">{preview}</strong>
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
