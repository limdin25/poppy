// usePropertyListings — every house this estate agency branch has listed, with
// the offer band already worked out, for the dialer's Houses tab.
//
// Keyed on the BRANCH PHONE, not a property id, because one agency lists many
// houses and Pedro rings the branch once rather than once per house. The RPC
// matches on the last 9 digits, so a number stored as "0191 625 0242" by the
// scraper and "+441916250242" by the ingest route is the same branch.
//
// Reads the wk_property_agent_listings RPC, not brrr_properties directly:
// that table has NO RLS and is service-role only by design, so an anon-key
// browser session cannot see a row of it. The RPC is SECURITY DEFINER with a
// wk_is_agent_or_admin() gate and an explicit projection.
//
// The offer band comes from the SAME offerRange() the dial cron and the admin
// page use — never recomputed here. See api/lib/brrr-offer.ts for why it is a
// percentage of what the house is worth today and never of GDV.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/browser';
import { offerRange, gbpShort, ladderText, upliftRefurb } from '../../../../api/lib/brrr-offer';
import {
  dealStrategy, dealBmvBand, dealConditionBand, dealReasonLine,
  type BmvBand,
} from '../../../../api/lib/brrr-deal-facts';
import type { NextStepBrief } from '../../../../api/lib/next-step-brief';

/** One row as the RPC returns it. */
interface ListingRow {
  id: string;
  source_property_id: string | null;
  listing_url: string | null;
  address: string | null;
  price_text: string | null;
  asking_price: number | null;
  bedrooms: number | null;
  property_type: string | null;
  days_on_market: string | null;
  floorplan_urls: string[] | null;
  deal: Record<string, unknown> | null;
  status: string | null;
  qualification: Record<string, unknown> | null;
  notes: string | null;
  call_channel: string | null;
  agent_name: string | null;
  agent_phone: string | null;
  offer_low_pct: number | null;
  offer_high_pct: number | null;
  last_call_at: string | null;
  last_call_channel: string | null;
  last_call_summary: string | null;
  /** The next-step brief the brain wrote after the last call on this house.
   *  Null on a property nobody has rung yet, which renders as nothing. */
  brief: NextStepBrief | null;
  /** The size the machine resolved overnight (advert text, EPC or floor
   *  plan). Null when nothing could read it, which is exactly when the card
   *  shows Pedro the floor-area question. */
  floor_area_sqm: number | null;
  /** Hugo's own instruction, pinned above the brief. */
  pinned_note: string | null;
}

/** One sold comparable behind the valuation, ready to read out loud.
 *
 *  The engine files these as OBJECTS in deal.evidence (comp_type, address,
 *  price, bedrooms, property_type, date_info, distance_label, url). They used
 *  to be pushed through String(), which is what printed "[object Object]"
 *  three times under "sold nearby, your evidence" on Pedro's screen. */
export interface PropertyComp {
  /** 'today' is a sale at the SAME bed count, so it is what the house is worth
   *  now. 'after' is a sale at the TARGET bed count, so it is what it is worth
   *  once the conversion is done. Saying one when you mean the other is how an
   *  agent quotes a 5 bed price for a 3 bed house. */
  when: 'today' | 'after';
  /** "3 bed terraced, 14 ORCHARD TERRACE, £92,000, Same road, sold 2026-05-01" */
  text: string;
  /** The listing behind it, empty when the engine had none. */
  url: string;
}

export interface PropertyListing extends ListingRow {
  /** Open here. Never higher. */
  offerMin: number;
  /** Walk away here. Never said out loud. */
  offerMax: number;
  /** "£108,000, then £114,000, then £119,500" */
  ladder: string;
  /** How much to trust the valuation: high | medium | low | insufficient. */
  confidence: string;
  /** Up to three sold comps, as sentences. */
  evidence: string[];
  /** Every sold comp the engine sent, split into what it is worth today and
   *  what it is worth converted. Empty when the row only carries the older
   *  flat sentences, and the screen falls back to `evidence` then. */
  comps: PropertyComp[];
  /** Plain-English warnings from the valuation engine. */
  flags: string[];
  isAuction: boolean;
  /** What it is worth with one more bedroom. This is the engine's GDV: it runs
   *  the whole comparables pipeline a second time over beds+1 sold comps, then
   *  caps it at the street ceiling and at 1.30x today's value. 0 when the
   *  engine could not establish it. */
  upliftValue: number;
  /** What that conversion costs, from the bedroom table in brrr-offer. 0 when
   *  the bed count is outside 1 to 3, where we have no figure and say so. */
  upliftRefurbBudget: number;
  /** The second brain withdrew this deal (status 'auditor_killed'). Hidden
   *  from the dialer entirely; Call history shows it, clearly marked, because
   *  a branch Pedro has already rung must never go blank. */
  withdrawn: boolean;
  /** Why, in the auditor's own words. Empty unless withdrawn. */
  withdrawnReasons: string[];
  /** When it was filed as withdrawn. ISO, empty when unknown. */
  withdrawnAt: string;
  /** Which deal this is: BRRR, FLIP, HMO. Null until the deal engine sends it.
   *  READ from the engine, never worked out here. See api/lib/brrr-deal-facts. */
  strategy: string | null;
  /** How far below market, as a band, so Pedro knows how hard to push. Null
   *  until the engine sends it, and never derived from the offer band: BMV is
   *  measured against GDV minus refurb, and the refurb figure never reaches
   *  this repo. */
  bmvBand: BmvBand | null;
  /** The condition read behind the refurb estimate, e.g. "full_refurb". Null
   *  when the engine did not say, or said "unknown" (about a third of them). */
  conditionBand: string | null;
  /** One line of why this is a deal. Empty string when there is nothing
   *  honest to say, which the strip renders as nothing at all. */
  reasonLine: string;
}

/** The engine's flag codes, in words an agent can use on the phone.
 *  This is now the ONLY copy. The AI qualifier that held the other one was
 *  retired on 2026-08-09, and its cron was deleted with it. */
const FLAG_NOTES: Record<string, string> = {
  conversion_adds_no_value: 'Converting this adds little value. The money has to come off the purchase price.',
  // The re-anchor and the second brain (deal_auditor.py), 2026-08-11. A kill
  // never reaches this screen; these are the flags that ride along on a deal
  // the auditor let through with reservations.
  cmv_far_above_asking_reanchored: 'Comps nearby run far above the asking price, so the band is anchored to asking. Verify the value before treating it as a bargain.',
  suspiciously_cheap_asking: 'Priced well below what the comps suggest. Find out why before you believe it.',
  deal_stack_unverified: 'No target-bed evidence, so the refinance sums are unverified.',
  bmv_claim_unproven: 'Below-market claim has no same-street sale behind it. Verify before leaning on it.',
  opener_far_below_asking: 'The opener is far below asking. Expect pushback; know your evidence.',
  conversion_value_unpriced: 'No 3-bed sales nearby, so the extra-bedroom value is a guess.',
  engine_vs_raw_median: 'The estimate drifts from the plain median of its own comps. Double-check it.',
  stack_limited: 'The walk-away is capped by the refinance sums, not the market value.',
  // The GDV flags. These live in deal.gdv.flags and were never read on this
  // path, so the dialer could show "with an extra bedroom: X" on a property the
  // engine had already flagged as gaining nothing from the conversion.
  street_ceiling_cap: 'The extra-bedroom value is capped by the best sale on that street.',
  uplift_exceeds_light_refurb_cap: 'The extra-bedroom value looks too good for a light refurb. Treat it with suspicion.',
  uplift_review: 'The uplift from the extra bedroom is large. Worth a second look before offering.',
  low_confidence: 'Thin sold evidence nearby. Treat the figures as a guide, not gospel.',
  wide_ring: 'The comparable sales are further away than ideal.',
  old_comps: 'The comparable sales are old. The local market may have moved.',
  no_ppsf_check: 'No floor area, so there was no price-per-square-foot cross-check.',
  priced_below_market: 'It looks keenly priced. Find out why: lease, condition, or a problem.',
  auction: 'Auction lot. There is no negotiation, only a maximum bid.',
};

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

/** One comp row from the engine, as a sentence.
 *
 *  Every field is optional in practice, so the sentence is assembled from
 *  whatever is actually there rather than from a fixed template with holes in
 *  it. The bed count leads because it is the thing that must not be muddled:
 *  a sale at the target size is not evidence of what the house is worth today.
 *
 *  Exported only so tests can pin it. Nothing else calls it. */
export function compText(c: Record<string, unknown>): string {
  const beds = str(c.bedrooms).trim();
  const type = str(c.property_type).trim().toLowerCase();
  const size = [beds ? `${beds} bed` : '', type].filter(Boolean).join(' ');
  const rawPrice = str(c.price).trim();
  // Land Registry prices arrive already formatted ("£92,000"); other sources
  // send a bare number, and "92000" read down a phone line is not a price.
  const price = /^[\d.]+$/.test(rawPrice) ? gbpShort(Number(rawPrice)) : rawPrice;
  const date = str(c.date_info).trim();
  return [
    size,
    str(c.address).trim(),
    price,
    str(c.distance_label).trim(),
    date ? `sold ${date}` : '',
  ].filter(Boolean).join(', ');
}

/** What the property is worth today, out of either deal shape.
 *  valuation.py returns deal.cmv = { estimate, confidence, ... }; the old
 *  browser Comps page sent a bare number. One helper so the two callers here
 *  cannot drift apart. */
function cmvOf(deal: Record<string, unknown> | null | undefined): number {
  const c = deal?.cmv;
  const n = typeof c === 'object' && c !== null
    ? Number((c as Record<string, unknown>).estimate)
    : Number(c);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** What it is worth with the extra bedroom. The engine already computes this as
 *  `gdv`, by running the whole comparables pipeline a second time over beds+1
 *  sold comps: it is not an estimate on top of an estimate. Written as a sibling
 *  of cmvOf, and for the same reason, because both deal shapes are live in the
 *  wild and two readers of the same field is how they drift. */
function gdvOf(deal: Record<string, unknown> | null | undefined): number {
  const g = deal?.gdv;
  const n = typeof g === 'object' && g !== null
    ? Number((g as Record<string, unknown>).estimate)
    : Number(g);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

interface Options {
  /** Include deals the auditor withdrew. The DIALER must never pass this:
   *  a withdrawn deal's figures are exactly what nobody may quote. Call
   *  history passes it so a rung branch still shows what it was about. */
  includeWithdrawn?: boolean;
}

export function usePropertyListings(phone: string | null | undefined, opts?: Options) {
  const includeWithdrawn = opts?.includeWithdrawn === true;
  const digits = (phone ?? '').replace(/\D/g, '');
  const enabled = digits.length >= 9;

  const q = useQuery({
    queryKey: ['property-listings', digits.slice(-9)],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<ListingRow[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('wk_property_agent_listings', {
        p_phone: phone,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as ListingRow[];
    },
  });

  const listings = useMemo<PropertyListing[]>(() => {
    return (q.data ?? []).map((r) => {
      const deal = r.deal ?? {};
      const pct = {
        offer_low_pct: r.offer_low_pct ?? 70,
        offer_high_pct: r.offer_high_pct ?? 75,
      };
      const band = offerRange(r, pct);
      // valuation.py NESTS its answer (deal.cmv = {estimate, confidence, ...},
      // deal.offer = {open, max, ladder, flags, verdict}); the old browser Comps
      // page flattened it. Both shapes are in the table, so read both. Reading
      // only the flat keys is what made a fully valued property show a grey
      // "no valuation" chip beside a real GBP 81,224 figure, and it is the same
      // fault that put a percentage of the asking price in the offer strip.
      const cmvObj = (deal.cmv && typeof deal.cmv === 'object')
        ? deal.cmv as Record<string, unknown> : null;
      const offerObj = (deal.offer && typeof deal.offer === 'object')
        ? deal.offer as Record<string, unknown> : {};
      const isAuction = deal.is_auction === true || deal.is_auction === '1'
        || String(offerObj.verdict ?? deal.verdict ?? '').includes('auction');
      // The GDV flags live on deal.gdv and were never read here, so a property
      // the engine had flagged as gaining nothing from the conversion could
      // still show an extra-bedroom figure with no warning beside it.
      const gdvObj = (deal.gdv && typeof deal.gdv === 'object')
        ? deal.gdv as Record<string, unknown> : null;
      // The second brain's reservations ride along with the deal
      // (deal.audit.reasons, written by deal_auditor.py on the VPS). A killed
      // deal never reaches this screen at all.
      const auditObj = (deal.audit && typeof deal.audit === 'object')
        ? deal.audit as Record<string, unknown> : null;
      const withdrawn = r.status === 'auditor_killed';
      // The auditor's own sentences, not the codes: "comps price it at 2.9x
      // the asking price and none of them are on the subject's street".
      const withdrawnReasons = withdrawn
        ? (Array.isArray(auditObj?.checks) ? auditObj.checks as Array<Record<string, unknown>> : [])
          .filter((c) => c.level === 'kill')
          .map((c) => str(c.detail))
          .filter(Boolean)
        : [];
      const flagSrc = [
        ...(Array.isArray(offerObj.flags) ? offerObj.flags as unknown[] : []),
        ...(Array.isArray(gdvObj?.flags) ? gdvObj.flags as unknown[] : []),
        ...(Array.isArray(deal.flags) ? deal.flags as unknown[] : []),
        // On a withdrawn deal the reasons are spelled out in full above, so
        // they are not repeated as one-line flags.
        ...(!withdrawn && Array.isArray(auditObj?.reasons) ? auditObj.reasons as unknown[] : []),
      ];
      const flagCodes = [...new Set(flagSrc.map(str))];
      // Evidence sentences. The flat shape carried deal.evidence; the nested
      // engine never emits that key, so every nested row fell through to
      // "no sold comparables on file" the moment the dialer merged its tokens
      // into the contact, even with five comps behind the number. Hugo's
      // screenshot of the Dixons contact is exactly that. Build the sentences
      // from the audit rows the engine already returns: raw sold price and
      // date, never the time-adjusted figure, because Pedro says these out
      // loud to someone who can check.
      const evidenceRows = Array.isArray(deal.evidence) ? (deal.evidence as unknown[]) : [];
      const flatEvidence = evidenceRows
        .filter((e) => typeof e === 'string').map(str).filter(Boolean);
      // The engine's own comp rows. build_pedro_list.py sends about ten per
      // property, half at today's bed count and half at the target, and until
      // 2026-08-12 every one of them rendered as "[object Object]".
      const comps: PropertyComp[] = evidenceRows
        .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
        .map((c) => ({
          when: str(c.comp_type).includes('target') ? 'after' as const : 'today' as const,
          text: compText(c),
          url: str(c.url).trim(),
        }))
        .filter((c) => c.text);
      const auditRows = Array.isArray(cmvObj?.audit)
        ? cmvObj.audit as Array<Record<string, unknown>> : [];
      const nestedEvidence = auditRows
        .filter((a) => a.included === true && Number(a.price) > 0)
        .slice(0, 3)
        .map((a) => `${str(a.address)} sold for ${gbpShort(Number(a.price))}${a.date ? ` (${str(a.date)})` : ''}`);
      const nUsed = Number(cmvObj?.n_used ?? 0);
      // Today's sales come first, always. This list is what the agent reads out
      // as the evidence for the price he is offering NOW, and a sale at the
      // converted size proves a different number entirely.
      const compEvidence = [
        ...comps.filter((c) => c.when === 'today'),
        ...comps.filter((c) => c.when === 'after'),
      ].map((c) => c.text);
      const evidence = flatEvidence.length > 0 ? flatEvidence.slice(0, 3)
        : compEvidence.length > 0 ? compEvidence.slice(0, 3)
          : nestedEvidence.length > 0 ? nestedEvidence
            : nUsed > 0 ? [`${nUsed} sold comparables nearby put it at ${gbpShort(cmvOf(deal))}`]
              : [];
      return {
        ...r,
        offerMin: band.min,
        offerMax: band.max,
        ladder: ladderText(deal, band, isAuction),
        confidence: str(cmvObj?.confidence ?? deal.cmv_confidence) || 'unknown',
        evidence,
        comps,
        flags: flagCodes.map((c) => FLAG_NOTES[c] ?? c).filter(Boolean),
        isAuction,
        upliftValue: gdvOf(deal),
        upliftRefurbBudget: upliftRefurb(r.bedrooms)?.budget ?? 0,
        withdrawn,
        withdrawnReasons,
        withdrawnAt: str(auditObj?.filed_at),
        // What the engine CONCLUDED, as opposed to what it computed. All three
        // are read straight out of the deal blob and are null on every property
        // until the new engine lands, which is the normal state and not a
        // fault. Nothing here is inferred from the offer band: see the header
        // of api/lib/brrr-deal-facts.ts for why that would be dangerous.
        strategy: dealStrategy(r),
        bmvBand: dealBmvBand(r),
        conditionBand: dealConditionBand(r),
        reasonLine: dealReasonLine(r, evidence),
      };
    }).filter((l) => includeWithdrawn || !l.withdrawn);
  }, [q.data, includeWithdrawn]);

  return {
    listings,
    loading: q.isLoading && enabled,
    error: q.error instanceof Error ? q.error.message : null,
    refetch: q.refetch,
  };
}

/** The script's [tokens] for one listing. Kept next to the maths so the words
 *  on screen and the words the agent reads can never use different figures. */
export function scriptTokensFor(l: PropertyListing | null | undefined): Record<string, string> {
  if (!l) return {};
  const addr = l.address ?? '';
  return {
    property_address: addr,
    // "Bedford Street, Coventry, West Midlands, CV1" -> "Bedford Street".
    property_street: addr.split(',')[0]?.trim() || addr,
    asking_price: l.price_text || gbpShort(l.asking_price),
    bedrooms: l.bedrooms != null ? String(l.bedrooms) : '',
    property_type: (l.property_type ?? '').toLowerCase(),
    days_on_market: l.days_on_market ?? '',
    agency: l.agent_name ?? '',
    // Same nesting again: cmv is an object, so gbpShort on it printed a dash.
    // This string is a script token the agent reads aloud, so "worth about —"
    // is not a cosmetic bug, it is Pedro saying nothing where a number belongs.
    property_worth: cmvOf(l.deal) > 0
      ? `${gbpShort(cmvOf(l.deal))}${l.confidence !== 'unknown' ? ` (${l.confidence} confidence)` : ''}`
      : 'not established',
    offer_open: gbpShort(l.offerMin),
    offer_ceiling: gbpShort(l.offerMax),
    ladder: l.ladder,
    // What it is worth once the kitchen becomes a bedroom. This is the whole
    // buying thesis, and until 2026-08-11 it never reached the contact, so
    // the coach could not say it and Hugo could not see it on the lead.
    worth_after_bed: l.upliftValue > 0
      ? `${gbpShort(l.upliftValue)} as a ${(l.bedrooms ?? 0) + 1} bed`
      : 'not established',
    comp_evidence: l.evidence.length ? l.evidence.join(' · ') : 'no sold comparables on file',
    valuation_notes: l.flags.length ? l.flags.join(' ') : 'nothing unusual flagged',
    // What the strip above the script shows him. The live coach is driven by
    // Twilio and rebuilds from the database on every caller utterance, so it
    // cannot see the screen: anything Pedro can read off the strip has to be
    // written onto the contact or the coach is coaching a different property.
    //
    // ALWAYS PRESENT, EMPTY WHEN UNKNOWN, and that is load-bearing. The dialer
    // merges this object over the contact's existing custom_fields, so a key
    // that is simply left out keeps whatever the LAST property wrote. Pedro
    // switches house mid-call constantly (one branch, many listings), and a
    // stale "STRONG DEAL" carried over from the previous property is exactly
    // the confidently wrong fact this whole screen exists to prevent. An empty
    // string overwrites it; interpolateScript and the coach both skip blanks.
    deal_strategy: l.strategy ?? '',
    bmv_band: l.bmvBand ? `${l.bmvBand.label}. ${l.bmvBand.note}` : '',
    deal_reason: l.reasonLine ?? '',
  };
}

/** The figures the AI offer drafter is allowed to use, and nothing else.
 *
 *  Hugo 2026-08-12: the offer email is written per house, off the listing and
 *  off what the agent said on the call. The model writes the English; every
 *  number it may use comes from here, because a model that can invent a price
 *  can invent an offer. The refurb figure is deliberately included and the
 *  endpoint is told never to print it: it explains the number without handing
 *  our costing to the seller. */
export function offerHouseFor(l: PropertyListing | null | undefined) {
  if (!l) return null;
  return {
    address: l.address,
    askingPrice: l.asking_price,
    offerPrice: l.offerMin > 0 ? l.offerMin : null,
    gdv: cmvOf(l.deal) > 0 ? cmvOf(l.deal) : null,
    refurb: refurbOf(l.deal),
    beds: l.bedrooms,
    propertyType: l.property_type,
    reasonLine: l.reasonLine || null,
    strategy: l.strategy,
  };
}

/** The engine files refurb in a couple of shapes across versions. 0 when it
 *  said nothing, which the drafter reads as "leave that line out". */
function refurbOf(deal: Record<string, unknown> | null | undefined): number | null {
  if (!deal) return null;
  for (const key of ['refurb', 'refurb_budget', 'refurb_cost']) {
    const raw = deal[key];
    const n = typeof raw === 'object' && raw !== null
      ? Number((raw as Record<string, unknown>).estimate)
      : Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}
