// "Houses | Auction" in the CRM top bar. Only shown to a login that has both
// desks (Pedro, and admins). Locked while a call is live or wrapping up,
// because switching rebuilds the whole CRM underneath, softphone included.

import { useState } from 'react';
import { useDesk, DESK_LABEL, type Desk } from '../lib/DeskContext';
import { useActiveCallCtx } from '../components/live-call/ActiveCallContext';

export default function DeskToggle() {
  const { desk, desks, resolved, setDesk } = useDesk();
  const { phase } = useActiveCallCtx();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!resolved || desks.length < 2) return null;
  const locked = phase !== 'idle';

  const pick = async (d: Desk) => {
    if (d === desk || busy || locked) return;
    setBusy(true);
    setError(null);
    const err = await setDesk(d);
    setBusy(false);
    if (err) setError(err);
  };

  return (
    <div className="flex items-center gap-2" data-testid="desk-toggle">
      <div
        role="tablist"
        aria-label="Which CRM"
        title={locked ? 'Finish the call before switching' : undefined}
        className={`flex rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-0.5 ${locked ? 'opacity-50' : ''}`}
      >
        {desks.map((d) => (
          <button
            key={d}
            role="tab"
            aria-selected={d === desk}
            disabled={locked || busy}
            onClick={() => void pick(d)}
            data-testid={`desk-${d}`}
            className={`px-3 py-1 text-[13px] font-semibold rounded-md transition-colors ${
              d === desk
                ? d === 'auction' ? 'bg-[#1A1A1A] text-white' : 'bg-white text-[#1A1A1A] shadow-sm'
                : 'text-[#6B7280] hover:text-[#1A1A1A]'
            }`}
          >
            {DESK_LABEL[d]}
          </button>
        ))}
      </div>
      {error && <span className="text-[12px] text-[#B91C1C]">Could not switch: {error}</span>}
    </div>
  );
}
