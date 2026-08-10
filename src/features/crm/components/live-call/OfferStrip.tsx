// The three numbers Pedro must not have to hunt for, pinned above the script.
//
// Hugo, 2026-08-09, on Tajul's NFStay screen: "without calculator how are we
// gonna know the offer between this and that number... I think we need this
// calculator in the middle."
//
// It lives at the top of the middle column, above the script, rather than in a
// tab, because the moment it scrolls away is the moment an agent guesses. The
// comps and floor plans that justify these figures are one click away in the
// Houses tab; these three are always on screen.
//
// The ceiling is red and carries a warning because it is the one number on the
// page that must never be said out loud. The AI qualifier is deliberately never
// told its own ceiling so it cannot leak it. A human has to know where to stop,
// so he is told and trusted, and the warning is what makes that safe.

import { AlertTriangle } from 'lucide-react';
import { gbpShort } from '../../../../../api/lib/brrr-offer';
import type { PropertyListing } from '../../hooks/usePropertyListings';

/** How much to trust the valuation, in a colour. */
const CONFIDENCE: Record<string, { label: string; cls: string }> = {
  high: { label: 'strong evidence', cls: 'bg-[#E8F5EC] text-[#2E7D43] border-[#CFE6D4]' },
  medium: { label: 'fair evidence', cls: 'bg-[#E8F5EC] text-[#2E7D43] border-[#CFE6D4]' },
  low: { label: 'thin evidence', cls: 'bg-[#FDF3E3] text-[#9A6B1E] border-[#EBD9B4]' },
  insufficient: { label: 'not enough sold data', cls: 'bg-[#F3F4F6] text-[#6B7280] border-[#E5E7EB]' },
  unknown: { label: 'no valuation', cls: 'bg-[#F3F4F6] text-[#6B7280] border-[#E5E7EB]' },
};

interface Props {
  listing: PropertyListing | null;
  /** How many houses this branch has, so he knows there are others to raise. */
  total?: number;
}

export default function OfferStrip({ listing, total = 0 }: Props) {
  if (!listing) {
    return (
      <div className="border-b border-[#E5E7EB] bg-[#FAFAF8] px-4 py-2.5 text-[12px] text-[#9CA3AF]">
        No property selected. Pick one in the Houses tab.
      </div>
    );
  }

  const conf = CONFIDENCE[listing.confidence] ?? CONFIDENCE.unknown;
  const noValuation = !listing.offerMax;
  // valuation.py nests this: deal.cmv = { estimate, low, high, audit }. The old
  // flow flattened it to a bare number, so read both.
  const cmvRaw = listing.deal?.cmv as unknown;
  const cmv = typeof cmvRaw === 'object' && cmvRaw !== null
    ? Number((cmvRaw as Record<string, unknown>).estimate) || 0
    : Number(cmvRaw) || 0;

  return (
    <div className="border-b border-[#E5E7EB] bg-white">
      <div className="flex items-baseline gap-2 px-4 pt-2.5 pb-1.5">
        <span className="truncate text-[12px] font-semibold text-[#1A1A1A]" title={listing.address ?? ''}>
          {listing.address || 'Property'}
        </span>
        <span className="whitespace-nowrap text-[11px] text-[#6B7280]">
          asking {listing.price_text || gbpShort(listing.asking_price)}
        </span>
        {total > 1 && (
          <span className="ml-auto whitespace-nowrap text-[11px] text-[#6B7280]">
            {total} on file
          </span>
        )}
      </div>

      {noValuation ? (
        <div className="mx-4 mb-2.5 flex items-start gap-2 rounded-md border border-[#EBD9B4] bg-[#FDF3E3] px-3 py-2 text-[12px] text-[#9A6B1E]">
          <AlertTriangle className="mt-px h-3.5 w-3.5 flex-shrink-0" />
          <span>
            No offer band for this one. The scraper sent it without a valuation, so
            do not name a figure. Gather the answers and let the director price it.
          </span>
        </div>
      ) : (
        <div className="flex flex-wrap items-stretch gap-px overflow-hidden border-y border-[#E5E7EB] bg-[#E5E7EB]">
          <Cell
            label="Open at"
            value={gbpShort(listing.offerMin)}
            note="Say this figure. Not a range."
            tone="open"
          />
          <Cell
            label="Then climb"
            value={listing.ladder}
            note="One step at a time, only when they give ground."
            tone="plain"
            small
          />
          <Cell
            label="Walk away at"
            value={gbpShort(listing.offerMax)}
            note="NEVER SAY THIS OUT LOUD"
            tone="ceiling"
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 px-4 py-1.5">
        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${conf.cls}`}>
          {conf.label}
        </span>
        {/* cmv is an OBJECT from valuation.py ({estimate, low, high, audit}),
            not a number. Passing the object to gbpShort produced "worth about
            — today" on every property, which reads as "we could not value
            this" beside a perfectly good valuation. Same nesting mistake as
            the offer band. */}
        {cmv > 0 ? (
          <span className="text-[11px] text-[#6B7280]">
            worth about {gbpShort(cmv)} today
          </span>
        ) : null}
        {/* What it is worth with the extra bedroom, and what that costs. The
            value is the engine's own GDV (the comps pipeline run again over
            beds+1), never a multiplier on top of today's figure. Hidden rather
            than guessed when either half is missing. */}
        {listing.upliftValue > 0 && (
          <span className="text-[11px] text-[#6B7280]">
            as a {(listing.bedrooms ?? 0) + 1} bed: {gbpShort(listing.upliftValue)}
            {listing.upliftRefurbBudget > 0
              ? `, refurb about ${gbpShort(listing.upliftRefurbBudget)}`
              : ''}
          </span>
        )}
        {listing.isAuction && (
          <span className="rounded border border-[#EBD9B4] bg-[#FDF3E3] px-1.5 py-0.5 text-[10px] font-semibold text-[#9A6B1E]">
            AUCTION
          </span>
        )}
        {listing.flags.length > 0 && (
          <span className="truncate text-[11px] text-[#9A6B1E]" title={listing.flags.join(' ')}>
            {listing.flags[0]}
          </span>
        )}
      </div>
    </div>
  );
}

function Cell({
  label, value, note, tone, small,
}: {
  label: string;
  value: string;
  note: string;
  tone: 'open' | 'ceiling' | 'plain';
  small?: boolean;
}) {
  const bg = tone === 'open' ? 'bg-[#F1F9F3]' : tone === 'ceiling' ? 'bg-[#FDF1F1]' : 'bg-white';
  const val = tone === 'open' ? 'text-[#2E7D43]' : tone === 'ceiling' ? 'text-[#A83232]' : 'text-[#1A1A1A]';
  const lab = tone === 'ceiling' ? 'text-[#B06060]' : 'text-[#8A9AAB]';
  return (
    <div className={`flex min-w-[132px] flex-1 flex-col gap-0.5 px-4 py-2 ${bg}`}>
      <span className={`text-[10px] font-bold uppercase tracking-wider ${lab}`}>{label}</span>
      <span className={`${small ? 'text-[13px]' : 'text-[19px]'} font-extrabold leading-tight ${val}`}>
        {value}
      </span>
      <span
        className={
          tone === 'ceiling'
            ? 'text-[9.5px] font-extrabold uppercase tracking-wider text-[#A83232]'
            : 'text-[10.5px] leading-snug text-[#6B7280]'
        }
      >
        {note}
      </span>
    </div>
  );
}
