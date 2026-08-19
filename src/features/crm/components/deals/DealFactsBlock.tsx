// The deal in six lines, on the card itself.
//
// Hugo, 19 Aug, on the pipeline: "I want to show asking price, I wanna see
// right away if there's a mistake before I open anything. Asking price and
// then brackets percent below market, then ballpark, and if it's a strong
// comparison it's written there, and the confidence, and refurbishment and
// why." Rendered on the board cards and the cockpit cards from the SAME facts
// object (wk_property_links.facts), so the two can never disagree.
//
// Every figure is READ from the engine. The one derived number, percent below
// market, is arithmetic on two read numbers: (worth - asking) / worth. When
// the asking price sits ABOVE the worth the badge goes red and says so, which
// is exactly the "see the mistake before I open anything" ask.

import type { DealFacts } from '../../hooks/usePropertyLinks';

const gbp = (n?: number | null) =>
  typeof n === 'number' && Number.isFinite(n) && n > 0
    ? `£${Math.round(n).toLocaleString('en-GB')}` : null;

/** Percent the asking price sits below the engine's worth. Negative = above. */
export function pctBelowMarket(asking?: number | null, worth?: number | null): number | null {
  if (!asking || !worth || asking <= 0 || worth <= 0) return null;
  return Math.round(((worth - asking) / worth) * 100);
}

const TIER_LABEL: Record<string, string> = {
  gold: 'comps GOLD', strong: 'comps strong', good: 'comps good',
  fair: 'comps fair', last_resort: 'comps weak',
};

const CONDITION_LABEL: Record<string, string> = {
  turnkey: 'turnkey', cosmetic: 'cosmetic', modernisation: 'modernisation',
  full_refurb: 'full refurb', derelict: 'derelict',
};

/** The same six facts off a cockpit deal, which carries `money` (armed) and
 *  `ballpark` (homework) instead of the RPC's facts object. Armed wins;
 *  Hugo's pinned ceiling outranks the engine's, same as everywhere else. */
export function factsFromCockpit(deal: {
  money: {
    asking: number | null; gdv: number | null; tmv: number | null;
    open: number | null; ceiling: number | null; refurb: number | null;
    pinnedCeiling: number | null; compsTier: string | null;
  };
  ballpark: {
    ok: boolean; open: number | null; ceiling: number | null;
    gdv: number | null; refurb: number | null; tier: string | null;
  } | null;
}): DealFacts | null {
  const m = deal.money;
  if (m.open || m.ceiling) {
    return {
      worth: m.tmv ?? m.gdv ?? undefined,
      open: m.open ?? undefined,
      ceiling: m.pinnedCeiling ?? m.ceiling ?? undefined,
      tier: m.compsTier ?? undefined,
      refurb: m.refurb ?? undefined,
      source: 'deal',
    };
  }
  const b = deal.ballpark;
  if (b?.ok) {
    return {
      worth: b.gdv ?? undefined,
      open: b.open ?? undefined,
      ceiling: b.ceiling ?? undefined,
      tier: b.tier ?? undefined,
      refurb: b.refurb ?? undefined,
      source: 'ballpark',
    };
  }
  return null;
}

export default function DealFactsBlock({ facts, asking, compact }: {
  facts: DealFacts | null | undefined;
  asking?: number | null;
  /** Board cards are narrow; compact drops the why to two lines. */
  compact?: boolean;
}) {
  if (!facts || (!facts.worth && !facts.open)) return null;

  const pct = pctBelowMarket(asking, facts.worth);
  const above = pct !== null && pct < 0;
  const band = facts.open && facts.ceiling
    ? `${gbp(facts.open)} to ${gbp(facts.ceiling)}`
    : gbp(facts.open) ?? gbp(facts.ceiling);

  return (
    <div
      className="mt-1.5 rounded-md border border-[#E5E7EB] bg-[#FAFAF8] px-2 py-1.5 text-[10.5px] leading-snug text-[#374151] space-y-0.5"
      data-testid="deal-facts-block"
    >
      <div className="flex items-baseline gap-1 flex-wrap">
        {gbp(asking) && <span>Asking <b className="text-[#1A1A1A]">{gbp(asking)}</b></span>}
        {pct !== null && (
          <span className={above
            ? 'font-bold text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] rounded px-1'
            : 'font-semibold text-[#166534]'}
          >
            ({above ? `${Math.abs(pct)}% ABOVE market` : `${pct}% below market`})
          </span>
        )}
      </div>
      {band && (
        <div>
          Ballpark <b className="text-[#1A1A1A]">{band}</b>
          {facts.source === 'ballpark' && (
            <span className="text-[#9A6B1E]"> · homework, not armed</span>
          )}
        </div>
      )}
      {(facts.tier || facts.confidence) && (
        <div>
          {facts.tier ? (TIER_LABEL[facts.tier] ?? `comps ${facts.tier}`) : ''}
          {facts.tier && facts.confidence ? ' · ' : ''}
          {facts.confidence ? `${facts.confidence} confidence` : ''}
        </div>
      )}
      {(gbp(facts.refurb) || facts.refurb === 0 || facts.condition) && (
        <div>
          Refurb <b className="text-[#1A1A1A]">{facts.refurb === 0 ? 'none needed' : gbp(facts.refurb) ?? 'not priced'}</b>
          {facts.condition ? ` · ${CONDITION_LABEL[facts.condition] ?? facts.condition}` : ''}
        </div>
      )}
      {facts.why && (
        <div
          className={`text-[#6B7280] ${compact ? 'line-clamp-2' : 'line-clamp-3'}`}
          title={facts.why}
        >
          {facts.why}
        </div>
      )}
    </div>
  );
}
