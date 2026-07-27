// The calculator icon, on every lead card in the CRM.
//
// Hugo 2026-07-27: "add a track as well for the leads that played with
// calculator, maybe just add a Calculator Icon, when that happens, add the icon
// on the lead card across the entire crm."
//
// Why this earns a permanent spot next to the name: watching the video is
// passive, and half of it happens by accident. Typing your own average job
// value into the ROI calculator is a lead working out whether this pays for
// itself. It is the strongest pre-purchase signal the page produces, so an
// agent scanning a list should be able to see it without opening anything.
//
// One component, one look, so the icon means the same thing on the funnel
// board, the inbox, the pipeline, contacts, the contact record and the dialer.

import { Calculator } from 'lucide-react';

/** Europe/London, matching every other stamp in the CRM. */
function whenLabel(at: string | null | undefined): string {
  if (!at) return '';
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(d);
}

export interface CalcChipProps {
  /** wk_vsl_pages.calc_at. Null or undefined renders nothing at all. */
  calcAt?: string | null;
  /** How many times they came back to it. */
  count?: number | null;
  /** `icon` for dense rows, `full` where there is room for a word. */
  variant?: 'icon' | 'full';
  className?: string;
}

export default function CalcChip({
  calcAt, count, variant = 'icon', className = '',
}: CalcChipProps) {
  // Absence is the common case and must cost no space: a greyed-out calculator
  // on 3,500 leads would train everyone to stop seeing the lit one.
  if (!calcAt) return null;

  const when = whenLabel(calcAt);
  const times = (count ?? 0) > 1 ? ` (${count} times)` : '';
  const title = `Played with the value calculator${times}${when ? ` · ${when}` : ''}`;

  return (
    <span
      data-testid="calc-chip"
      title={title}
      aria-label={title}
      className={
        'inline-flex items-center gap-1 rounded-[6px] border border-[#BBF7D0] ' +
        `bg-[#F0FDF4] text-[#166534] font-semibold shrink-0 ${
          variant === 'full' ? 'text-[10px] px-1.5 py-0.5' : 'text-[10px] p-[3px]'
        } ${className}`
      }
    >
      <Calculator className="w-3 h-3" />
      {variant === 'full' && <span>Used the calculator</span>}
      {variant === 'icon' && (count ?? 0) > 1 && <span className="leading-none">{count}</span>}
    </span>
  );
}
