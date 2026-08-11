// The house behind the phone number, one click away.
//
// Hugo, 2026-08-11: "I have no link to go see the property on rightmove."
//
// The link was never missing from the DATA. brrr_properties.listing_url has
// been populated on all 262 properties since the scraper started sending them,
// and three surfaces already rendered it: the dialer's Houses tab, the admin
// Properties page and the call monitor. It was missing from the two screens
// Hugo actually works in, the CRM board and Call history.
//
// ONE CHIP PER HOUSE, capped at three. Most branches (134 of 178) list exactly
// one, but a few list up to eight, and a single "view property" link on an
// eight-house branch would silently pick one and hide the rest. The overflow
// count is rendered rather than dropped, and its tooltip names every address
// that did not fit.
//
// stopPropagation is load-bearing: on the CRM board this sits inside the card's
// own button, and without it clicking through to Rightmove would also fire the
// card's edit modal behind the new tab.

import { ExternalLink } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import type { PropertyLink } from '../../hooks/usePropertyLinks';

/** "Holloway Head, BIRMINGHAM, West Midlands, B1, B1 1HR" -> "Holloway Head" */
function street(address: string | null): string {
  return (address ?? '').split(',')[0]?.trim() || 'View listing';
}

/** "Holloway Head — 2 bed Flat — £100,000", for the hover. */
function describe(p: PropertyLink): string {
  return [
    p.address ?? 'Unknown address',
    p.bedrooms != null ? `${p.bedrooms} bed` : null,
    p.property_type ?? null,
    p.price_text ?? (p.asking_price != null ? `£${Number(p.asking_price).toLocaleString('en-GB')}` : null),
  ]
    .filter(Boolean)
    .join(' · ');
}

export default function PropertyLinkChips({
  links,
  max = 3,
  className,
}: {
  links: PropertyLink[] | undefined;
  max?: number;
  className?: string;
}) {
  if (!links || links.length === 0) return null;
  const shown = links.slice(0, max);
  const hidden = links.slice(max);

  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {shown.map((p) => (
        <a
          key={p.property_id}
          href={p.listing_url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          title={`${describe(p)} — opens Rightmove in a new tab`}
          className="inline-flex items-center gap-1 max-w-full text-[9px] font-semibold bg-[#00DEB6]/12 text-[#0E7C68] px-1.5 py-0.5 rounded hover:bg-[#00DEB6]/25 hover:underline"
        >
          <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" />
          <span className="truncate">{street(p.address)}</span>
        </a>
      ))}
      {hidden.length > 0 && (
        <span
          className="text-[9px] font-medium text-[#6B7280]"
          title={hidden.map(describe).join('\n')}
        >
          +{hidden.length} more
        </span>
      )}
    </div>
  );
}
