// The desk picker in the CRM top bar: Houses, Auction, Serviced Accommodation.
//
// A two-way switch until 2026-09-23, when Hugo asked for a drop down: "instead
// of toggle I wanna drop down menu for Pedro. He can change for auction, but he
// can change as well to service accommodation."
//
// Only shown to a login that has more than one desk (Pedro, and admins).
// Locked while a call is live or wrapping up, because switching rebuilds the
// whole CRM underneath, softphone included.

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useDesk, DESK_LABEL, asDesk } from '../lib/DeskContext';
import { useActiveCallCtx } from '../components/live-call/ActiveCallContext';

export default function DeskToggle() {
  const { desk, desks, resolved, setDesk } = useDesk();
  const { phase } = useActiveCallCtx();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!resolved || desks.length < 2) return null;
  const locked = phase !== 'idle';

  const pick = async (value: string) => {
    const d = asDesk(value);
    if (d === desk || busy || locked) return;
    setBusy(true);
    setError(null);
    const err = await setDesk(d);
    setBusy(false);
    if (err) setError(err);
  };

  return (
    <div className="flex items-center gap-2" data-testid="desk-toggle">
      <label
        title={locked ? 'Finish the call before switching' : 'Which CRM'}
        className={`relative flex items-center ${locked ? 'opacity-50' : ''}`}
      >
        <span className="sr-only">Which CRM</span>
        <select
          value={desk}
          disabled={locked || busy}
          onChange={(e) => void pick(e.target.value)}
          data-testid="desk-select"
          className={`appearance-none rounded-lg border py-1 pl-3 pr-8 text-[13px] font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20 ${
            desk === 'houses'
              ? 'border-[#E5E7EB] bg-white text-[#1A1A1A]'
              : 'border-[#1A1A1A] bg-[#1A1A1A] text-white'
          }`}
        >
          {desks.map((d) => (
            <option key={d} value={d} className="bg-white text-[#1A1A1A]">
              {DESK_LABEL[d]}
            </option>
          ))}
        </select>
        <ChevronDown
          className={`pointer-events-none absolute right-2 h-3.5 w-3.5 ${desk === 'houses' ? 'text-[#6B7280]' : 'text-white'}`}
        />
      </label>
      {error && <span className="text-[12px] text-[#B91C1C]">Could not switch: {error}</span>}
    </div>
  );
}
